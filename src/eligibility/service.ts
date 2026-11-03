import { clinic } from '../clinic.js';
import { env, isStediSandbox } from '../config.js';
import type { Patient } from '../data/patients.js';
import { memberIdFromSpeech, parseDateOfBirth, splitFullName } from '../normalize.js';
import { lookupPatient, pickByCoverage } from '../patients.js';
import { payerByKey, resolvePayer, type Payer } from '../payers.js';
import { checkEligibility } from '../stedi/client.js';
import type { EligibilityRequest, EligibilityResponse } from '../stedi/types.js';
import { verificationFailures } from '../store.js';
import { interpretEligibility, type EligibilityFacts, type VisitType } from './interpret.js';
import { buildAnswer, dentalAnswer, type AgentAnswer } from './script.js';

export interface VerifyInput {
  full_name: string;
  date_of_birth?: string;
  insurance_company?: string;
  member_id?: string;
  policyholder_name?: string;
  policyholder_date_of_birth?: string;
  visit_type?: VisitType;
  use_insurance_on_file?: boolean;
}

export type ToolOutcome = AgentAnswer['outcome'] | 'NEED_INFO' | 'UNKNOWN_INSURANCE' | 'WHICH_INSURANCE';

export interface VerifyResult {
  answer: Omit<AgentAnswer, 'outcome'> & { outcome: ToolOutcome };
  /** Everything needed to audit the answer later. Never sent to the voice model. */
  audit: {
    patientId?: string;
    payerKey?: string;
    request?: EligibilityRequest;
    httpStatus?: number;
    stediCheckId?: string;
    attempts?: number;
    ms?: number;
    facts?: EligibilityFacts;
    transportError?: string;
    rawResponse?: EligibilityResponse;
  };
}

const ask = (say: string, next_step: string, outcome: ToolOutcome = 'NEED_INFO'): VerifyResult => ({
  answer: { outcome, say, next_step, facts: {} },
  audit: {},
});

export async function verifyInsurance(input: VerifyInput, callId: string): Promise<VerifyResult> {
  const dob = input.date_of_birth ? parseDateOfBirth(input.date_of_birth) : null;
  if (input.date_of_birth && !dob) {
    return ask(`Sorry, I didn't catch that date of birth. Could you say it again, month, day, and year?`, 'Call check_insurance again with the date of birth as YYYY-MM-DD.');
  }

  // 1. Who is the patient?
  const lookup = lookupPatient(input.full_name, dob);
  if (lookup.status === 'need_date_of_birth') {
    return ask(`Could I get your date of birth so I pull up the right chart?`, 'Call check_insurance again with date_of_birth as YYYY-MM-DD.');
  }
  const onFile: Patient[] = lookup.status === 'found' ? lookup.patients : [];

  // 2. Which insurance?
  let payer: Payer | undefined;
  let spokenMemberId = input.member_id ?? '';
  if (input.use_insurance_on_file) {
    const record = onFile.length === 1 ? onFile[0]! : undefined;
    if (!record) {
      return ask(`I don't have insurance on file for you yet. Do you have your insurance card handy?`, 'Collect the insurance company name and member ID, then call check_insurance again.');
    }
    payer = payerByKey(record.coverage.payerKey);
    spokenMemberId = record.coverage.memberId;
  } else {
    if (!input.insurance_company) {
      return ask(`Which insurance company is your plan with?`, 'Call check_insurance again with insurance_company.');
    }
    const resolved = resolvePayer(input.insurance_company, onFile[0]?.coverage.payerKey);
    if (resolved.status === 'ambiguous') {
      const names = resolved.options.map((p) => p.displayName);
      return ask(
        `There are a few plans by that name. Is yours ${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}? It should say on the front of your card.`,
        'Call check_insurance again with the exact insurance company name.',
        'WHICH_INSURANCE',
      );
    }
    if (resolved.status === 'unknown') {
      return ask(
        `I don't see ${input.insurance_company} on the list of plans I can check automatically. That doesn't necessarily mean we don't take it.`,
        `Ask them to read the insurance company name exactly as printed on the card and try once more. If it's still not recognized, offer a callback so the front desk can verify it manually, and call request_callback.`,
        'UNKNOWN_INSURANCE',
      );
    }
    payer = resolved.payer;
  }
  if (!payer) return ask(`Which insurance company is your plan with?`, 'Call check_insurance again with insurance_company.');

  // Patients regularly read us their dental card. No need to bother a payer to know that.
  if (payer.kind === 'dental' || !payer.stediPayerId) {
    return { answer: dentalAnswer(payer), audit: { payerKey: payer.key } };
  }
  if (!spokenMemberId.trim()) {
    return ask(`And what's the member ID on your ${payer.displayName} card?`, 'Read the member ID back to confirm, then call check_insurance again with member_id.');
  }

  // 3. Whose policy is it? Prefer the chart when the card the caller read matches it.
  const patient = pickByCoverage(onFile, payer.key, spokenMemberId) ?? (onFile.length === 1 ? onFile[0] : undefined);
  const cardMatchesChart = !!patient && pickByCoverage([patient], payer.key, spokenMemberId) !== undefined;
  const memberId = cardMatchesChart ? patient!.coverage.memberId : memberIdFromSpeech(spokenMemberId);

  const spoken = splitFullName(input.full_name);
  const patientName = patient
    ? { firstName: patient.firstName, lastName: patient.lastName }
    : { firstName: titleCase(spoken.first), lastName: titleCase(spoken.last) };
  const patientDob = patient?.dateOfBirth ?? dob;
  if (!patientDob) {
    return ask(`And what's your date of birth?`, 'Call check_insurance again with date_of_birth as YYYY-MM-DD.');
  }

  let policyholder: { firstName: string; lastName: string; dateOfBirth?: string } | undefined;
  if (input.policyholder_name) {
    const ph = splitFullName(input.policyholder_name);
    const phDob = input.policyholder_date_of_birth ? parseDateOfBirth(input.policyholder_date_of_birth) : null;
    if (normalizedName(ph) !== normalizedName({ first: patientName.firstName, last: patientName.lastName })) {
      policyholder = { firstName: titleCase(ph.first), lastName: titleCase(ph.last), dateOfBirth: phDob ?? undefined };
    }
  } else if (cardMatchesChart && patient!.coverage.relationship !== 'self') {
    policyholder = patient!.coverage.policyholder;
  }

  const request: EligibilityRequest = {
    payerId: payer.stediPayerId,
    externalPatientId: patient?.id,
    provider: { name: { organization: clinic.name }, npi: env.STEDI_PROVIDER_NPI },
    subscriber: policyholder
      ? {
          name: { person: { firstName: policyholder.firstName, lastName: policyholder.lastName } },
          memberId,
          ...(policyholder.dateOfBirth ? { dateOfBirth: policyholder.dateOfBirth } : {}),
        }
      : { name: { person: patientName }, memberId, dateOfBirth: patientDob },
    ...(policyholder ? { dependent: { name: { person: patientName }, dateOfBirth: patientDob } } : {}),
    // The sandbox only supports STC 30; in production we'd also request 98 (office visit) and AL (vision).
    encounter: { services: [{ system: 'STC', value: '30' }] },
  };

  // 4. Ask the payer.
  const result = await checkEligibility(request);
  const ctx = ctxFor(payer, input, patient, callId, patientName.firstName);

  if (result.kind === 'transport_error') {
    const setup = result.httpStatus === 401 || result.httpStatus === 403 || result.httpStatus === 400;
    const answer = buildAnswer(
      { kind: 'payer_error', code: String(result.httpStatus ?? 'network'), description: result.error, category: setup ? 'clinic_setup' : 'payer_unavailable' },
      ctx,
    );
    return { answer, audit: { patientId: patient?.id, payerKey: payer.key, request, httpStatus: result.httpStatus, transportError: result.error, attempts: result.attempts, ms: result.ms } };
  }

  const facts = interpretEligibility(result.body, {
    visitType: input.visit_type,
    enforcePlanDates: !isStediSandbox,
    clinicNetworks: payer.clinicNetworks,
  });
  const answer = buildAnswer(facts, ctx);
  return {
    answer,
    audit: {
      patientId: patient?.id,
      payerKey: payer.key,
      request,
      httpStatus: result.httpStatus,
      stediCheckId: result.body.id,
      attempts: result.attempts,
      ms: result.ms,
      facts,
      rawResponse: result.body,
    },
  };
}

function ctxFor(payer: Payer, input: VerifyInput, patient: Patient | undefined, callId: string, firstName?: string) {
  return {
    payer,
    firstName: firstName ?? patient?.firstName ?? titleCase(splitFullName(input.full_name).first),
    visitType: input.visit_type ?? 'medical',
    priorFailures: verificationFailures(callId),
  } as const;
}

function titleCase(s: string): string {
  return s.replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

function normalizedName(n: { first: string; last: string }): string {
  return `${n.first} ${n.last}`.toLowerCase();
}
