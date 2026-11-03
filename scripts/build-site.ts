/**
 * Builds the answers on the project site (site/, deployed to Netlify). Every answer is produced
 * here by the production interpreter from the same captured 271 responses the golden tests pin,
 * then written into site/index.html as static receipts, so the page can't drift from what the
 * agent actually says and works without JavaScript.
 *
 *   yarn site:build
 */
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { PATIENTS } from '../src/data/patients.js';
import { interpretEligibility } from '../src/eligibility/interpret.js';
import { buildAnswer, type Outcome } from '../src/eligibility/script.js';
import { payerByKey } from '../src/payers.js';
import type { EligibilityResponse } from '../src/stedi/types.js';
import { GOLDEN } from '../test/golden-cases.js';

const GROUP: Record<Outcome, 'accepted' | 'staff' | 'declined' | 'error'> = {
  ACCEPTED: 'accepted',
  ACCEPTED_COPAY_UNCONFIRMED: 'staff',
  COVERAGE_UNCONFIRMED: 'staff',
  NOT_IN_NETWORK: 'declined',
  COVERAGE_INACTIVE: 'declined',
  DENTAL_PLAN: 'declined',
  VISION_PLAN: 'declined',
  PLEASE_VERIFY_DETAILS: 'error',
  PAYER_UNAVAILABLE: 'error',
  CLINIC_SETUP_ISSUE: 'error',
};

const fixtures = new URL('../test/fixtures/', import.meta.url);
const out = new URL('../site/data/', import.meta.url);
mkdirSync(new URL('271/', out), { recursive: true });

const scenarios = GOLDEN.map(([id, expected, , source]) => {
  const patient = PATIENTS.find((p) => p.id === id);
  if (!patient) throw new Error(`No patient ${id}`);
  const payer = payerByKey(patient.coverage.payerKey)!;
  const response = JSON.parse(readFileSync(new URL(`${id}.json`, fixtures), 'utf8')) as EligibilityResponse;
  // Same options as the golden tests: sandbox mocks carry frozen 2024 plan dates.
  const facts = interpretEligibility(response, { enforcePlanDates: false, clinicNetworks: payer.clinicNetworks });
  const answer = buildAnswer(facts, { payer, firstName: patient.firstName, visitType: 'medical', priorFailures: 0 });
  if (answer.outcome !== expected) throw new Error(`${id}: expected ${expected}, got ${answer.outcome}`);
  copyFileSync(new URL(`${id}.json`, fixtures), new URL(`271/${id}.json`, out));

  const { policyholder, relationship, memberId } = patient.coverage;
  return {
    id,
    name: `${patient.firstName} ${patient.lastName}`,
    dateOfBirth: patient.dateOfBirth,
    payer: payer.displayName,
    memberId,
    onPlanOf: relationship === 'self' || !policyholder ? null : `${relationship} of ${policyholder.firstName} ${policyholder.lastName}`,
    group: GROUP[answer.outcome],
    outcome: answer.outcome,
    say: answer.say,
    nextStep: answer.next_step,
    source: facts.kind === 'payer_error' ? `${source}: ${facts.description}` : source,
    raw: `data/271/${id}.json`,
  };
});

writeFileSync(new URL('scenarios.json', out), JSON.stringify({ generatedAt: new Date().toISOString(), scenarios }, null, 1));

// Static receipts and filter chips, written between markers in the page.
const STAMP: Record<Outcome, string> = {
  ACCEPTED: 'Accepted',
  ACCEPTED_COPAY_UNCONFIRMED: 'Staff confirms copay',
  COVERAGE_UNCONFIRMED: 'Staff confirms',
  NOT_IN_NETWORK: 'Not in network',
  COVERAGE_INACTIVE: 'Inactive',
  DENTAL_PLAN: 'Dental card',
  VISION_PLAN: 'Vision plan',
  PLEASE_VERIFY_DETAILS: 'Re-check details',
  PAYER_UNAVAILABLE: 'Payer down',
  CLINIC_SETUP_ISSUE: 'Our setup',
};
const FILTERS = [['all', 'All'], ['accepted', 'Accepted'], ['staff', 'Staff confirms'], ['declined', 'Not accepted'], ['error', 'Insurer errors']] as const;
const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const curly = (t: string) => t.replace(/'/g, '\u2019');
const born = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).toUpperCase();

const receipts = scenarios.map((s) => [
  `<article class="receipt" data-group="${s.group}" data-id="${s.id}" data-say="${esc(s.say)}">`,
  `<header><span>${esc(s.name)} · ${esc(s.payer)}</span><span class="stamp st-${s.group}">${STAMP[s.outcome]}</span></header>`,
  `<p class="meta">BORN ${born(s.dateOfBirth)} · ID ${esc(s.memberId)}${s.onPlanOf ? ` · ${esc(s.onPlanOf.toUpperCase())}` : ''}</p>`,
  `<p class="lbl">Riley says</p>`,
  `<p class="said">\u201C${esc(curly(s.say))}\u201D</p>`,
  s.group === 'accepted' ? '' : `<p class="then"><b>Then:</b> ${esc(curly(s.nextStep))}</p>`,
  `<p class="lbl">Read from the insurer\u2019s response</p>`,
  `<p class="src">${esc(s.source)}</p>`,
  `<a class="raw" href="${s.raw}" target="_blank" rel="noopener">Raw 271 \u2197</a>`,
  `<div class="live-run"><button class="run" type="button">Run it live</button><span class="live-out" aria-live="polite"></span></div>`,
  `</article>`,
].filter(Boolean).join('')).join('\n');
const count = (g: string) => (g === 'all' ? scenarios.length : scenarios.filter((s) => s.group === g).length);
const chips = FILTERS.map(([g, label]) => `<button class="chip" type="button" data-filter="${g}" aria-pressed="${g === 'all'}">${label}<span>${count(g)}</span></button>`).join('');

const pagePath = new URL('../site/index.html', import.meta.url);
let page = readFileSync(pagePath, 'utf8');
// A replacer function, not a replacement string: "$15" in a copay would otherwise read as a back-reference.
const between = (html: string, name: string, body: string) =>
  html.replace(new RegExp(`<!-- ${name}:start -->[\\s\\S]*<!-- ${name}:end -->`), () => `<!-- ${name}:start -->\n${body}\n<!-- ${name}:end -->`);
page = between(page, 'filters', chips);
page = between(page, 'answers', receipts);
page = page.replace(/(<span data-count="scenarios">)\d+(<\/span>)/g, `$1${scenarios.length}$2`);
writeFileSync(pagePath, page);
console.log(`Wrote ${scenarios.length} answers into site/index.html and their raw 271 responses to site/data/`);
