import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PATIENTS } from '../src/data/patients.js';
import { interpretEligibility } from '../src/eligibility/interpret.js';
import { buildAnswer } from '../src/eligibility/script.js';
import { payerByKey } from '../src/payers.js';
import type { EligibilityResponse } from '../src/stedi/types.js';
import { GOLDEN } from './golden-cases.js';

const fixture = (id: string): EligibilityResponse => JSON.parse(readFileSync(new URL(`./fixtures/${id}.json`, import.meta.url), 'utf8'));

describe('what callers hear, pinned to real payer responses', () => {
  it.each(GOLDEN)('%s -> %s', (id, outcome, mustSay) => {
    const patient = PATIENTS.find((p) => p.id === id)!;
    const payer = payerByKey(patient.coverage.payerKey)!;
    // Sandbox mocks carry frozen 2024 plan dates; production enforces them (see interpret.test.ts).
    const facts = interpretEligibility(fixture(id), { enforcePlanDates: false, clinicNetworks: payer.clinicNetworks });
    const answer = buildAnswer(facts, { payer, firstName: patient.firstName, visitType: 'medical', priorFailures: 0 });
    expect(answer.outcome).toBe(outcome);
    expect(answer.say).toMatch(mustSay);
  });

  it('never quotes a dollar amount unless the plan is accepted', () => {
    for (const [id, outcome] of GOLDEN) {
      if (outcome === 'ACCEPTED') continue;
      const patient = PATIENTS.find((p) => p.id === id)!;
      const payer = payerByKey(patient.coverage.payerKey)!;
      const answer = buildAnswer(interpretEligibility(fixture(id), { enforcePlanDates: false }), { payer, firstName: patient.firstName, visitType: 'medical', priorFailures: 0 });
      // Only the clinic's own self-pay price may appear.
      expect(answer.say.replace(/175 dollars/g, '')).not.toMatch(/\d+ dollars/);
    }
  });

  it('with production date rules, a 2024 plan the payer still calls active is escalated, not answered', () => {
    const facts = interpretEligibility(fixture('pt-rod-beck'), { enforcePlanDates: true, asOf: '2026-11-02' });
    const answer = buildAnswer(facts, { payer: payerByKey('cigna')!, firstName: 'Rod', visitType: 'medical', priorFailures: 0 });
    expect(answer.outcome).toBe('COVERAGE_UNCONFIRMED');
    expect(answer.next_step).toMatch(/request_callback/);
  });

  it('a routine exam adds the refraction heads-up and uses the vision benefit when there is one', () => {
    const payer = payerByKey('bcbs-tx')!;
    const facts = interpretEligibility(fixture('pt-jane-doe-2015'), { enforcePlanDates: false, visitType: 'routine' });
    const answer = buildAnswer(facts, { payer, firstName: 'Jane', visitType: 'routine', priorFailures: 0 });
    expect(answer.say).toMatch(/routine eye exam, your plan's vision benefit shows a copay of 25 dollars/);
    expect(answer.say).toMatch(/refraction/);
  });
});
