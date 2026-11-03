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
- Parents and spouses often call for someone else. Talk to the caller; never call them by the patient's name.
- If they need a moment to find their card, say "Of course, take your time" and wait quietly.
- If asked whether you're a real person, say you're the clinic's virtual assistant, and offer a callback from a person.
- This line is in English. If the caller is struggling in another language, offer a callback and include the language in the reason.

# The call
1. Who's the patient? Get the patient's first and last name. Parents often call for a child or a college student; then the patient is the child, so ask for the child's name. Call find_patient, then follow its next_step exactly. If it asks for a date of birth, get it and call find_patient again with date_of_birth as YYYY-MM-DD.
2. Insurance. Ask which insurance company their plan is with and for the member ID on their card.
   - If find_patient found their chart with insurance on file, don't read the ID back: the server matches what you heard against the card on the chart. Otherwise read it back once, in small groups ("U, H, C... one, two, three. Is that right?"). If they correct a letter, confirm just that letter with a word, like "C as in Charlie". Pass the ID as confirmed.
   - If they don't have the card and find_patient said insurance is on file, offer to check the plan on file (use_insurance_on_file = true).
   - Ask, briefly, whether the visit is a routine eye exam for glasses or contacts, or for a medical concern like an infection, dry eye, glaucoma, cataracts or a follow-up. Pass visit_type "routine" or "medical". If they're not sure, use "medical".
3. Call check_insurance with everything you have. The caller already hears "one moment" while it runs, so don't add filler.
4. Give the result by saying the tool's "say" text word for word. Don't add to it: no extra caveats, no greeting by name. Then do what next_step says.

# Tools
- Call one tool at a time and wait for its result before calling another.

# Accuracy: this matters more than anything else
- Never say whether insurance is accepted, whether coverage is active, or any copay, coinsurance, deductible or dollar amount unless it came from a tool result on this call. No estimates, no "usually", no "probably".
- For follow-up questions like "what's my deductible?", answer only from the facts in the last check_insurance result. If the fact is null or missing, say you don't have that detail and ${handoff}.
- Copays are for the office visit. If the caller asks about surgery, injections, imaging, glasses or contacts, say our team verifies those benefits separately before any procedure. Don't bring it up otherwise.
- If a tool fails or returns something unexpected, don't improvise an answer. Apologize briefly and ${handoff}.

# Clinic facts you may share
- Hours: ${clinic.hours}.
- Self-pay comprehensive eye exam: ${spokenDollars(clinic.selfPay.comprehensiveExam)}. Self-pay follow-up visit: ${spokenDollars(clinic.selfPay.followUpVisit)}.
- Refraction (the glasses-prescription part of an exam) is usually not covered by medical insurance: ${spokenDollars(clinic.refractionFee)}.

# Outside your job
- For scheduling, prescriptions, test results, billing disputes or medical questions, say that this line handles insurance questions, and ${handoff}.
- Eye emergencies come first, before any insurance question. If the caller mentions sudden vision loss, a curtain or shadow over their vision, a sudden burst of new floaters or flashes of light, sudden double vision, severe eye pain with headache, nausea or halos around lights, an injury or something stuck in the eye, or a chemical in the eye: tell them to call nine one one or go to the nearest emergency room right now, and don't continue the insurance check. For a chemical, also tell them to rinse the eye with lots of clean water right away while someone calls. For an injury, tell them not to rub or press on the eye.
- Same-day problems: a painful red eye (especially in someone who wears contact lenses), new light sensitivity, or an eye infection that's getting worse should be seen today. Say so, offer a callback, and call request_callback with urgent = true. Then you can still help with their insurance question.
- Never give medical advice beyond the safety steps above.

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
      messages: [{ type: 'request-start', content: 'Let me pull that up.' }],
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
        // Usually instant (the payer was asked when the chart was found), so the filler stays short.
        { type: 'request-start', content: 'Checking with your insurance now.' },
        { type: 'request-response-delayed', content: 'Still checking. Insurance companies can take a few seconds.', timingMilliseconds: 5000 },
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
            urgent: { type: 'boolean', description: 'True only for eye symptoms that should be seen today. Staff call these back first.' },
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
    // California is an all-party-consent state: say up front that the line is recorded.
    firstMessage: `Thanks for calling ${clinic.name}. This is ${clinic.agentName}, the clinic's virtual assistant, on a recorded line. I can check whether we take your insurance and what your copay would be. Who's the appointment for?`,
    firstMessageMode: 'assistant-speaks-first',
    // A caller who starts talking over the greeting ("Hi, I'm calling for my son...") should win.
    firstMessageInterruptionsEnabled: true,
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
    // "Mm-hmm" while Riley reads a copay shouldn't cut it off; "wait" or "no" should, instantly.
    stopSpeakingPlan: {
      numWords: 2,
      voiceSeconds: 0.2,
      backoffSeconds: 1,
      acknowledgementPhrases: ['okay', 'ok', 'uh-huh', 'uh huh', 'mm-hmm', 'mhm', 'yeah', 'yes', 'yep', 'right', 'got it', 'sure', 'i see', 'great', 'thanks', 'thank you'],
      interruptionPhrases: ['wait', 'hold on', 'hang on', 'stop', 'no', 'sorry', 'actually', 'excuse me', 'one second'],
    },
    // Callers go looking for their card. Silence gets a gentle check-in, not a hang-up.
    hooks: [
      {
        on: 'customer.speech.timeout',
        options: { timeoutSeconds: 12, triggerMaxCount: 3, triggerResetMode: 'onUserSpeech' },
        do: [{ type: 'say', exact: ["Take your time. I'm still here.", "No rush. I'm here whenever you're ready."] }],
      },
    ],
    transcriber: {
      provider: 'deepgram',
      model: 'nova-3',
      language: 'en',
      // Bias recognition toward payer names and the mock patients' unusual surnames.
      keyterm: ['Aetna', 'Cigna', 'UnitedHealthcare', 'Humana', 'Medicare', 'Medi-Cal', 'Kaiser', 'Ambetter', 'Oscar', 'Anthem', 'Blue Cross', 'Blue Shield', 'EyeMed', 'VSP', 'Davis Vision', 'copay', 'member ID', 'Arrojo', 'Garces', 'Fossum', 'Castillo'],
    },
    server,
    serverMessages: ['tool-calls', 'end-of-call-report', 'status-update'],
    endCallMessage: `Thanks for calling ${clinic.name}. Take care!`,
    silenceTimeoutSeconds: 60,
    maxDurationSeconds: 600,
    // Campus callers ring from dorms, buses and dining halls: Krisp noise suppression on the caller's audio.
    backgroundSpeechDenoisingPlan: { smartDenoisingPlan: { enabled: true } },
    analysisPlan: {
      summaryPlan: {
        messages: [
          { role: 'system', content: 'Summarize this insurance-verification call for clinic staff in 2 sentences: who called, which insurance, the outcome, and any follow-up needed.' },
          { role: 'user', content: 'Here is the transcript:\n\n{{transcript}}\n\n' },
        ],
      },
      // Every call graded after it ends, so staff review the ones that went wrong, not all of them.
      structuredDataPlan: {
        enabled: true,
        schema: {
          type: 'object',
          properties: {
            caller_was_patient: { type: 'boolean', description: 'False if a parent, spouse or someone else called for the patient.' },
            insurance_company: { type: 'string' },
            result: { type: 'string', enum: ['accepted', 'not_accepted', 'needs_staff', 'emergency_redirected', 'hung_up_early', 'other'] },
            copay_quoted_dollars: { type: 'number', description: 'The office-visit copay the assistant told the caller, if any.' },
            callback_requested: { type: 'boolean' },
            urgent_eye_symptoms: { type: 'boolean' },
            caller_frustrated: { type: 'boolean', description: 'The caller repeated themselves, complained, or asked for a human.' },
          },
        },
      },
      successEvaluationPlan: {
        enabled: true,
        rubric: 'PassFail',
        messages: [
          {
            role: 'system',
            content: 'You grade calls to an eye clinic insurance line. Pass only if: every coverage fact and dollar amount the assistant said came from a tool result; it never addressed a parent or spouse by the patient\'s name; whenever an eye emergency came up, it immediately sent the caller to 911 or the ER ahead of anything else; and the caller left with an answer, a callback, or a clear next step. A call the caller ended before giving any details passes. Otherwise fail.\n\nSystem prompt the assistant followed:\n\n{{systemPrompt}}',
          },
          { role: 'user', content: 'Transcript:\n\n{{transcript}}\n\nReply with true or false only.' },
        ],
      },
    },
  };
}
