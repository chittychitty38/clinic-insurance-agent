import { z } from 'zod';
import { clinic } from '../clinic.js';
import { prefetchCoverageOnFile, verifyInsurance } from '../eligibility/service.js';
import { parseDateOfBirth } from '../normalize.js';
import { lookupPatient } from '../patients.js';
import { payerByKey } from '../payers.js';
import { addCallback, getCall, recordEvent } from '../store.js';

/**
 * Tool handlers. Each returns a flat JSON string for the model: what to say plus what
 * to do next. The model gets no other data, so it can't leak or invent anything.
 */

const FindPatientArgs = z.object({
  full_name: z.string().optional(),
  date_of_birth: z.string().optional(),
});

const CheckInsuranceArgs = z.object({
  full_name: z.string().min(1),
  date_of_birth: z.string().optional(),
  insurance_company: z.string().optional(),
  member_id: z.string().optional(),
  policyholder_name: z.string().optional(),
  policyholder_date_of_birth: z.string().optional(),
  visit_type: z.enum(['medical', 'routine']).optional().catch(undefined),
  use_insurance_on_file: z.boolean().optional(),
});

const CallbackArgs = z.object({
  caller_name: z.string().min(1),
  phone_number: z.string().optional(),
  reason: z.string().min(1),
  urgent: z.boolean().optional().catch(undefined),
});

export interface ToolContext {
  callId: string;
  callerNumber?: string;
}

type Handler = (args: unknown, ctx: ToolContext) => Promise<string>;

export const toolHandlers: Record<string, Handler> = {
  async find_patient(raw, ctx) {
    const started = Date.now();
    const args = FindPatientArgs.parse(raw ?? {});
    const dob = args.date_of_birth ? parseDateOfBirth(args.date_of_birth) : null;
    const lookup = lookupPatient(args.full_name ?? '', dob);

    let out: Record<string, unknown>;
    let startedPrefetch: string | undefined;
    if (!args.full_name?.trim()) {
      // Seen on a real call: the model fired a second, empty find_patient alongside the real one.
      out = { status: 'need_name', next_step: 'Ignore this result if you already called find_patient with a name. Otherwise ask for the patient\'s first and last name.' };
    } else if (args.date_of_birth && !dob) {
      out = { status: 'unclear_date_of_birth', next_step: 'Ask for the date of birth again: month, day and year.' };
    } else if (lookup.status === 'need_date_of_birth') {
      out = { status: 'need_date_of_birth', next_step: 'Several patients share that name. Ask for the patient\'s date of birth, then call find_patient again with date_of_birth.' };
    } else if (lookup.status === 'found') {
      const p = lookup.patients[0]!;
      const sameCard = lookup.patients.every((x) => x.coverage.payerKey === p.coverage.payerKey && x.coverage.memberId === p.coverage.memberId);
      const payerOnFile = sameCard ? payerByKey(p.coverage.payerKey)?.displayName : undefined;
      // Ask the payer about the card on file now, so the answer is ready when the caller reads it.
      const prefetching = sameCard && prefetchCoverageOnFile(p, ctx.callId);
      out = {
        status: 'found',
        first_name: p.firstName,
        ...(lookup.exactName ? {} : { name_on_chart: `${p.firstName} ${p.lastName}` }),
        insurance_on_file: payerOnFile ?? null,
        next_step: [
          lookup.exactName ? '' : `The chart spells the name ${p.firstName} ${p.lastName}; briefly confirm that's them.`,
          `Say you found the chart. If the caller is ${p.firstName}, use their name; if they're calling for ${p.firstName}, don't call them by ${p.firstName}'s name.`,
          `Then ask which insurance company the plan is with and for the member ID on the card.`,
          payerOnFile ? `If they don't have the card handy, offer to check the ${payerOnFile} plan on file.` : '',
        ].filter(Boolean).join(' '),
      };
      startedPrefetch = prefetching ? p.id : undefined;
    } else if (lookup.status === 'dob_mismatch') {
      out = {
        status: 'no_chart_with_that_birthday',
        next_step: 'Say you don\'t see a chart with that birthday, which is fine: they may be a new patient. Continue: ask for their insurance company and member ID, then call check_insurance with full_name and date_of_birth.',
      };
    } else {
      out = {
        status: 'not_found',
        next_step: 'Say you don\'t see them in our system yet, which is fine for new patients. Ask for their date of birth, insurance company and member ID, then call check_insurance with all of it.',
      };
    }
    recordEvent(ctx.callId, { tool: 'find_patient', args, outcome: String(out.status), ms: Date.now() - started });
    if (startedPrefetch) recordEvent(ctx.callId, { tool: 'prefetch', args: { patientId: startedPrefetch }, outcome: 'STARTED', ms: 0 });
    return JSON.stringify(out);
  },

  async check_insurance(raw, ctx) {
    const started = Date.now();
    const args = CheckInsuranceArgs.parse(raw);
    const { answer, audit } = await verifyInsurance(args, ctx.callId);
    recordEvent(ctx.callId, { tool: 'check_insurance', args, outcome: answer.outcome, say: answer.say, ms: Date.now() - started, detail: audit });
    console.log(JSON.stringify({ evt: 'check_insurance', callId: ctx.callId, outcome: answer.outcome, payer: audit.payerKey, stediCheckId: audit.stediCheckId, ms: audit.ms }));
    return JSON.stringify(answer);
  },

  async request_callback(raw, ctx) {
    const started = Date.now();
    const args = CallbackArgs.parse(raw);
    const phone = args.phone_number?.trim() || ctx.callerNumber || null;
    const cb = addCallback({ callId: ctx.callId, callerName: args.caller_name, phone, reason: args.reason, urgent: args.urgent ?? false });
    recordEvent(ctx.callId, { tool: 'request_callback', args, outcome: 'CALLBACK_CREATED', ms: Date.now() - started, detail: cb });
    return JSON.stringify({
      status: 'created',
      say: args.urgent
        ? `All set. I've marked this urgent, so our team will call you back today.`
        : `All set. Someone from our front desk will call you back ${clinic.callbackPromise}.`,
      next_step: phone ? 'Ask if there is anything else you can help with.' : 'Ask for the best phone number, then call request_callback again with phone_number.',
    });
  },
};

export async function runTool(name: string, args: unknown, ctx: ToolContext): Promise<{ result?: string; error?: string }> {
  const handler = toolHandlers[name];
  if (!handler) return { error: `Unknown tool ${name}` };
  getCall(ctx.callId, { callerNumber: ctx.callerNumber });
  try {
    return { result: await handler(args, ctx) };
  } catch (err) {
    console.error(`tool ${name} failed`, err);
    recordEvent(ctx.callId, { tool: name, args: (args ?? {}) as Record<string, unknown>, outcome: 'TOOL_ERROR', ms: 0, detail: String(err) });
    // A failure still has to give the model a safe script, never silence.
    return {
      result: JSON.stringify({
        status: 'error',
        say: "I'm sorry, I ran into a problem on my end and I don't want to give you a wrong answer.",
        next_step: 'Offer a callback from the front desk and call request_callback if they want one.',
      }),
    };
  }
}
