/**
 * End-to-end conversation eval through Vapi's Chat API: same assistant, prompt, tools and
 * webhook as a phone call, minus the audio. A rule-based "caller" answers whatever the
 * agent asks, so runs are repeatable and cost nothing beyond model tokens.
 *
 *   yarn eval:calls                 # all scenarios
 *   yarn eval:calls --only kaiser   # scenarios whose name contains "kaiser"
 */
import { env } from '../src/config.js';
import { clinic } from '../src/clinic.js';

interface Caller {
  name: string;
  /** What the caller says when asked who the appointment is for. */
  intro: string;
  dob: string;
  insurance: string;
  visit: string;
  /** Extra replies for scenario-specific questions, matched against the agent's last message. */
  extra?: [RegExp, string][];
  /** The agent must say something matching every one of these at some point. */
  expect: RegExp[];
  /** ...and must never say anything matching these. */
  forbid?: RegExp[];
}

const NO_DOLLARS = /\b\d+ dollars?\b(?! and)/i;

const CALLERS: Caller[] = [
  {
    name: 'student on parent plan (Aetna)',
    intro: "Hi, I'm calling for my son, Jordan Doe. He's a student at the university.",
    dob: 'July fourteenth, two thousand one',
    insurance: "It's Aetna. The member ID is A E T N A 9 w c s u.",
    visit: "It's for a medical issue, his eye has been red and irritated.",
    expect: [/in network with Aetna|accept/i, /copay|coinsurance|percent/i],
  },
  {
    name: 'returning patient (Cigna), speech-to-text misspells surname',
    intro: 'This is Rolando Arroyo.',
    dob: 'January second, nineteen seventy one',
    insurance: 'Cigna, member ID 5 6 4 3 2 9 6.',
    visit: 'Glaucoma follow up.',
    expect: [/in network with Cigna|accept/i],
  },
  {
    name: 'Medicare patient',
    intro: 'Hi, my name is Jane Doe.',
    dob: 'May fifth, nineteen fifty five',
    insurance: "I have Medicare. My number is 1 A A 2 C C 3 D D 4 5.",
    visit: "It's about my cataracts.",
    expect: [/Medicare/i, /percent/i],
    forbid: [/your copay should be/i],
  },
  {
    name: 'Kaiser member (out of network)',
    intro: 'Jane Doe calling.',
    dob: 'February second, two thousand two',
    insurance: 'Kaiser Permanente, member ID K A I S E R 1 2 3 4 5 6.',
    visit: 'Routine eye exam for new glasses.',
    expect: [/not in network/i, /self-pay|175/i],
    forbid: [/good news/i],
  },
  {
    name: 'inactive coverage (UHC)',
    intro: "Hi, it's Jane Doe.",
    dob: 'January first, nineteen seventy one',
    insurance: 'United Healthcare, member ID U H C inactive.',
    visit: 'Medical, I have floaters I want checked, they have been there for a few months.',
    extra: [[/newer|different|another (insurance )?card/i, "No, that's the only card I have."]],
    expect: [/inactive/i],
    forbid: [/good news/i, NO_DOLLARS],
  },
  {
    name: 'payer system down (AAA 42)',
    intro: 'Jane Doe here.',
    dob: 'January first, two thousand one',
    insurance: 'United Healthcare, member ID U H C A A A 4 2.',
    visit: 'Medical.',
    extra: [[/(best|good) (phone )?number|reach you/i, 'This number is fine, 5 5 5 0 1 0 0 1 2 1.']],
    expect: [/call you back|callback/i],
    forbid: [/good news/i, NO_DOLLARS],
  },
  {
    name: 'reads the dental card by mistake',
    intro: 'Falcon Dent.',
    dob: 'June seventh, nineteen eighty five',
    insurance: 'Ameritas, member ID 0 0 7 0 0 7 0 0 7.',
    visit: 'Routine exam.',
    extra: [[/medical (insurance )?card/i, "Oh, I don't have that with me right now."]],
    expect: [/dental/i],
    forbid: [/good news/i],
  },
  {
    name: 'eye emergency is routed to 911, not an insurance check',
    intro: "Hi, I'm Rod Beck. I suddenly can't see out of my left eye, it's like a curtain came down.",
    dob: 'February third, nineteen seventy two',
    insurance: 'Cigna R5TJR4HR4H.',
    visit: 'Medical.',
    expect: [/911|nine one one|emergency room/i],
    forbid: [/good news/i, NO_DOLLARS],
  },
];

function reply(c: Caller, agent: string, turn: number): string | null {
  const a = agent.toLowerCase();
  for (const [re, text] of c.extra ?? []) if (re.test(agent)) return text;
  if (/anything else|help you with today\?$|other questions/.test(a)) return "No, that's everything. Thanks!";
  if (/is that (right|correct)|did i get that right|confirm/.test(a)) return "Yes, that's right.";
  if (/date of birth|birthday|born/.test(a)) return c.dob;
  if (/routine|medical concern|reason for (the|your) visit|what.*(visit|appointment) is for/.test(a)) return c.visit;
  if (/insurance|member id|card/.test(a)) return c.insurance;
  if (/who|name|appointment for/.test(a)) return c.intro;
  if (/goodbye|take care|have a (great|good)/.test(a)) return null;
  return turn > 10 ? null : "Sorry, could you repeat that?";
}

async function chat(body: Record<string, unknown>): Promise<{ id: string; output: { role: string; content?: string }[] }> {
  const res = await fetch('https://api.vapi.ai/chat', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.VAPI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`chat ${res.status}: ${await res.text()}`);
  return res.json() as never;
}

async function assistantId(): Promise<string> {
  const res = await fetch('https://api.vapi.ai/assistant?limit=100', { headers: { Authorization: `Bearer ${env.VAPI_API_KEY}` } });
  const list = (await res.json()) as { id: string; name: string }[];
  const a = list.find((x) => x.name === `${clinic.name} insurance line`);
  if (!a) throw new Error('Assistant not found. Run `yarn vapi:sync` first.');
  return a.id;
}

async function run(c: Caller, id: string): Promise<boolean> {
  const transcript: string[] = [];
  let previousChatId: string | undefined;
  let callerSays: string | null = c.intro;
  for (let turn = 0; callerSays && turn < 14; turn++) {
    transcript.push(`  caller: ${callerSays}`);
    const r = await chat({ assistantId: id, input: callerSays, ...(previousChatId ? { previousChatId } : {}) });
    previousChatId = r.id;
    const said = r.output.filter((m) => m.role === 'assistant' && m.content).map((m) => m.content!).join(' ');
    if (said) transcript.push(`  ${clinic.agentName.toLowerCase()}:  ${said}`);
    callerSays = reply(c, said, turn);
  }
  const agentText = transcript.filter((l) => !l.startsWith('  caller')).join(' ');
  const missing = c.expect.filter((re) => !re.test(agentText));
  const leaked = (c.forbid ?? []).filter((re) => re.test(agentText));
  const ok = !missing.length && !leaked.length;
  console.log(`\n${ok ? 'PASS' : 'FAIL'}  ${c.name}`);
  console.log(transcript.join('\n'));
  if (missing.length) console.log(`  !! never said: ${missing.join(', ')}`);
  if (leaked.length) console.log(`  !! should not have said: ${leaked.join(', ')}`);
  return ok;
}

const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1]!.toLowerCase() : undefined;
const id = await assistantId();
const selected = CALLERS.filter((c) => !only || c.name.toLowerCase().includes(only));
const results: boolean[] = [];
for (const c of selected) results.push(await run(c, id));
const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${selected.length} conversations passed.`);
process.exit(passed === selected.length ? 0 : 1);
