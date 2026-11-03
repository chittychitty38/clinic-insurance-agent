/**
 * Builds the data behind the project site (site/, deployed to Netlify). Every answer on the
 * site is produced here by the production interpreter from the same captured 271 responses
 * the golden tests pin, so the site can't drift from what the agent actually says.
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
console.log(`Wrote ${scenarios.length} scenarios and their raw 271 responses to site/data/`);
