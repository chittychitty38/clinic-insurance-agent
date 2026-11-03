import { clinic } from '../clinic.js';
import { env } from '../config.js';
import { spokenDollars } from '../normalize.js';

/**
 * The whole Vapi assistant as code, so `yarn vapi:sync` can recreate it from git and every
 * prompt change goes through review like any other change.
 */

export const WEBHOOK_PATH = '/vapi/webhook';
export const WEBHOOK_SECRET_HEADER = 'x-webhook-secret';

export function systemPrompt(opts: { canTransfer: boolean }): string {
  const handoff = opts.canTransfer
    ? 'offer to transfer them to the front desk with transfer_call_tool, or offer a callback with request_callback'
    : 'offer a callback from the front desk with request_callback';

  return `You are ${clinic.agentName}, the virtual front-desk assistant for ${clinic.name}, an ophthalmology (eye doctor) practice near campus. You're on a live phone call. Your one job: tell callers whether we accept their insurance and what their copay will be for a visit.

# How you sound
- Warm, calm and efficient, like the best front-desk person they've ever talked to. Short sentences. One question at a time.
- This is a voice call. Never use lists, symbols, abbreviations or markdown. Say dates like "July fourteenth, two thousand one".
- Don't repeat the caller's whole sentence back to them, and don't over-apologize.

# The call
1. Who's the patient? Get the patient's first and last name. Parents often call for a child or a college student; then the patient is the child, so ask for the child's name. Call find_patient, then follow its next_step exactly. If it asks for a date of birth, get it and call find_patient again with date_of_birth as YYYY-MM-DD.
2. Insurance. Ask which insurance company their plan is with and for the member ID on their card.
   - Read the member ID back one character at a time ("U, H, C, one, two, three. Is that right?") and fix it if they correct you. Pass it exactly as confirmed.
   - If they don't have the card and find_patient said insurance is on file, offer to check the plan on file (use_insurance_on_file = true).
   - Ask, briefly, whether the visit is a routine eye exam for glasses or contacts, or for a medical concern like an infection, dry eye, glaucoma, cataracts or a follow-up. Pass visit_type "routine" or "medical". If they're not sure, use "medical".
3. Call check_insurance with everything you have. The caller already hears "one moment" while it runs, so don't add filler.
4. Give the result by saying the tool's "say" text. You may smooth the wording for speech, but keep every fact, number and caveat. Then do what next_step says.

# Accuracy: this matters more than anything else
- Never say whether insurance is accepted, whether coverage is active, or any copay, coinsurance, deductible or dollar amount unless it came from a tool result on this call. No estimates, no "usually", no "probably".
- For follow-up questions like "what's my deductible?", answer only from the facts in the last check_insurance result. If the fact is null or missing, say you don't have that detail and ${handoff}.
- Copays are for the office visit. Don't promise coverage for surgery, injections, imaging, glasses or contacts. Say our team verifies those benefits separately before any procedure.
- If a tool fails or returns something unexpected, don't improvise an answer. Apologize briefly and ${handoff}.

# Clinic facts you may share
- Hours: ${clinic.hours}.
- Self-pay comprehensive eye exam: ${spokenDollars(clinic.selfPay.comprehensiveExam)}. Self-pay follow-up visit: ${spokenDollars(clinic.selfPay.followUpVisit)}.
- Refraction (the glasses-prescription part of an exam) is usually not covered by medical insurance: ${spokenDollars(clinic.refractionFee)}.

# Outside your job
- For scheduling, prescriptions, test results, billing disputes or medical questions, say that this line handles insurance questions, and ${handoff}.
- Eye emergencies: if the caller mentions sudden vision loss, a curtain or shadow over their vision, a sudden burst of new floaters or flashes of light, a chemical splash, an eye injury, or severe eye pain, tell them to call nine one one or go to the nearest emergency room right away. Don't continue the insurance check.
- Never give medical advice.

# Privacy
- Only discuss the patient the caller named. Never read out a member ID or birth date the caller didn't give you, and never reveal anything about other patients.

# Ending
- Once their question is answered, ask if there's anything else. If not, thank them by name, say goodbye, and call end_call_tool.`;
}

export function buildAssistant(serverUrl: string) {
  const server = {
    url: `${serverUrl}${WEBHOOK_PATH}`,
    timeoutSeconds: 30,
    ...(env.VAPI_WEBHOOK_SECRET ? { headers: { [WEBHOOK_SECRET_HEADER]: env.VAPI_WEBHOOK_SECRET } } : {}),
  };
  const canTransfer = !!env.FRONT_DESK_NUMBER;

  const tools: Record<string, unknown>[] = [
    {
      type: 'function',
      server,
      function: {
        name: 'find_patient',
        description: 'Look up the patient in the clinic chart. Call it as soon as you have the patient\'s first and last name.',
        parameters: {
          type: 'object',
          properties: {
            full_name: { type: 'string', description: 'Patient first and last name, as the caller said it.' },
            date_of_birth: { type: 'string', description: 'Patient date of birth as YYYY-MM-DD. Only include it once the caller has given it.' },
          },
          required: ['full_name'],
        },
      },
    },
    {
      type: 'function',
      server,
      messages: [
        { type: 'request-start', content: 'One moment while I check that with your insurance.' },
        { type: 'request-response-delayed', content: 'Still checking. Insurance companies can take a few seconds.', timingMilliseconds: 7000 },
      ],
      function: {
        name: 'check_insurance',
        description: 'Run a real-time eligibility check with the patient\'s insurance company and get back exactly what to tell the caller.',
        parameters: {
          type: 'object',
          properties: {
            full_name: { type: 'string', description: 'Patient first and last name.' },
            date_of_birth: { type: 'string', description: 'Patient date of birth as YYYY-MM-DD, if the caller gave it.' },
            insurance_company: { type: 'string', description: 'Insurance company as the caller said it, e.g. "United Healthcare" or "Blue Cross".' },
            member_id: { type: 'string', description: 'Member ID exactly as the caller confirmed it, letters and digits only.' },
            policyholder_name: { type: 'string', description: 'Only if the plan is under someone else (a parent or spouse): that person\'s full name.' },
            policyholder_date_of_birth: { type: 'string', description: 'Only with policyholder_name: their date of birth as YYYY-MM-DD, if known.' },
            visit_type: { type: 'string', enum: ['medical', 'routine'], description: 'routine = eye exam for glasses or contacts; medical = any eye problem or follow-up.' },
            use_insurance_on_file: { type: 'boolean', description: 'True only if the caller asked to use the insurance already on file instead of reading their card.' },
          },
          required: ['full_name'],
        },
      },
    },
    {
      type: 'function',
      server,
      function: {
        name: 'request_callback',
        description: 'Ask a front-desk staff member to call the caller back. Use it whenever you can\'t give a confident answer, or the caller needs something outside insurance questions.',
        parameters: {
          type: 'object',
          properties: {
            caller_name: { type: 'string', description: 'Name of the person to call back.' },
            phone_number: { type: 'string', description: 'Best number to reach them, if different from the number they are calling from.' },
            reason: { type: 'string', description: 'One sentence for staff: what they need and anything we already learned.' },
          },
          required: ['caller_name', 'reason'],
        },
      },
    },
    { type: 'endCall', function: { name: 'end_call_tool' } },
  ];
  if (canTransfer) {
    tools.push({
      type: 'transferCall',
      function: { name: 'transfer_call_tool' },
      destinations: [
        { type: 'number', number: env.FRONT_DESK_NUMBER, message: 'Of course, transferring you to our front desk now.', description: 'Clinic front desk' },
      ],
    });
  }

  return {
    name: `${clinic.name} insurance line`,
    firstMessage: `Thanks for calling ${clinic.name}, this is ${clinic.agentName}, the virtual assistant. I can check whether we take your insurance and what your copay would be. Who's the appointment for?`,
    firstMessageMode: 'assistant-speaks-first',
    model: {
      provider: env.VAPI_MODEL_PROVIDER,
      model: env.VAPI_MODEL,
      temperature: 0.2,
      maxTokens: 300,
      messages: [{ role: 'system', content: systemPrompt({ canTransfer }) }],
      tools,
    },
    // Many eye patients are older: a slightly slower voice, and patience while they read a card.
    voice: { provider: env.VAPI_VOICE_PROVIDER, voiceId: env.VAPI_VOICE_ID, speed: 0.95 },
    startSpeakingPlan: {
      waitSeconds: 0.5,
      // Default is 0.4s after a number, which cuts people off mid-member-ID ("U H C ... 1 2 ...").
      transcriptionEndpointingPlan: { onPunctuationSeconds: 0.3, onNoPunctuationSeconds: 1.5, onNumberSeconds: 1.8 },
    },
    transcriber: {
      provider: 'deepgram',
      model: 'nova-3',
      language: 'en',
      // Bias recognition toward payer names and the mock patients' unusual surnames.
      keyterm: ['Aetna', 'Cigna', 'UnitedHealthcare', 'Humana', 'Medicare', 'Kaiser', 'Ambetter', 'Oscar', 'Anthem', 'Arrojo', 'Garces', 'Fossum', 'Castillo'],
    },
    server,
    serverMessages: ['tool-calls', 'end-of-call-report', 'status-update'],
    endCallMessage: `Thanks for calling ${clinic.name}. Take care!`,
    silenceTimeoutSeconds: 30,
    maxDurationSeconds: 600,
    backgroundDenoisingEnabled: true,
    analysisPlan: {
      summaryPlan: {
        messages: [
          { role: 'system', content: 'Summarize this insurance-verification call for clinic staff in 2 sentences: who called, which insurance, the outcome, and any follow-up needed.' },
          { role: 'user', content: 'Here is the transcript:\n\n{{transcript}}\n\n' },
        ],
      },
    },
  };
}
