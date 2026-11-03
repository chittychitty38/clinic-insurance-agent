import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PATIENTS } from '../src/data/patients.js';
import { interpretEligibility } from '../src/eligibility/interpret.js';
import { buildAnswer, type Outcome } from '../src/eligibility/script.js';
import { payerByKey } from '../src/payers.js';
import type { EligibilityResponse } from '../src/stedi/types.js';

/**
 * Golden tests on real 271 responses captured from the Stedi sandbox (`yarn eval --save`).
 * Each row pins what the caller hears. Every amount was checked by hand against the
 * benefit line it came from (noted on the right), so a change to any rule that alters a
 * spoken number fails here first.
 */
const GOLDEN: [patientId: string, outcome: Outcome, mustSay: RegExp, why: string][] = [
  ['pt-jordan-doe-2001', 'ACCEPTED', /specialist visit .* 15 dollars/, 'Aetna 98 IN_NETWORK FAMILY POS 11 "Specialist Visit or Evaluation" $15'],
  ['pt-jane-doe-2004', 'ACCEPTED', /office visit .* 30 dollars/, 'Aetna 98 "Office Visits, Walk in Clinic, Mental Health" $30 (one price for all three)'],
  ['pt-john-doe-1975', 'ACCEPTED', /specialist visit .* 45 dollars/, 'Anthem 98 "SPECIALIST, PAR NETWORK" $45; EPO $30 dropped (clinic is PAR only)'],
  ['pt-jane-doe-2015', 'ACCEPTED', /office visit .* 25 dollars/, 'BCBS TX 98 POS 11 "OFFICE VISIT - PROFESSIONAL" $25'],
  ['pt-jane-doe-2001-oscar', 'ACCEPTED', /specialist visit .* 25 dollars/, 'Oscar 98 "TELEHEALTH SPECIALIST,VISIT OFFICE SPECIALIST" $25; PCP $5 never quoted'],
  ['pt-casey-fossum', 'ACCEPTED', /specialist visit .* 20 dollars/, 'Cigna 98 POS 99 "Specialist" $20; client-network and telehealth $10 excluded'],
  ['pt-rod-beck', 'ACCEPTED', /office visit .* 25 dollars/, 'Cigna 98 $25, no labels'],
  ['pt-rolando-arrojo', 'ACCEPTED', /no copay and no coinsurance/, 'Cigna only has vendor/client-network copays; POS 11 specialist coinsurance 0%'],
  ['pt-jane-doe-1971', 'ACCEPTED', /office visit .* 15 dollars.*requires a referral/, 'UHC BY (office: sick) $15; "PCP TO SUBMIT A SPECIALIST REFERRAL"; BZ well-visit ignored'],
  ['pt-jordan-doe-2015', 'ACCEPTED', /10 percent/, 'Cigna 30 coinsurance 0.1, no visit copay'],
  ['pt-james-jones', 'ACCEPTED', /10 percent/, 'Cigna 30 coinsurance 0.1; only copays are pharmacy'],
  ['pt-frank-castillo', 'ACCEPTED', /10 percent.*700 dollars left/, 'Cigna 30 coinsurance 0.1; behavioral-health copays ignored'],
  ['pt-rich-garces', 'ACCEPTED', /10 percent/, 'Cigna 30 coinsurance 0.1'],
  ['pt-jane-doe-1975', 'ACCEPTED', /20 percent.*deductible is already met/, 'Humana 98 "PHYSICIAN OFFICE VISIT SPECIALIST" 0.2; remaining deductible 0'],
  ['pt-jane-doe-1955', 'ACCEPTED', /Qualified Medicare Beneficiary/, 'CMS Part B active; coinsurance 0 with insuranceType QUALIFIED_MEDICARE_BENEFICIARY'],
  ['pt-david-cone', 'ACCEPTED_COPAY_UNCONFIRMED', /don't want to guess/, 'Cigna response has statuses and limitations only, no cost-sharing at all'],
  ['pt-jane-doe-1952', 'NOT_IN_NETWORK', /specific plan lists our office as out of network/, 'UHC status message "PROVIDER IS OUT NETWORK FOR MEMBER"'],
  ['pt-jane-doe-2002', 'NOT_IN_NETWORK', /not in network with Kaiser/, 'Clinic has no Kaiser contract'],
  ['pt-john-doe-1994', 'NOT_IN_NETWORK', /not in network with Ambetter/, 'Clinic has no Ambetter contract'],
  ['pt-jane-doe-1971-inactive', 'COVERAGE_INACTIVE', /inactive/, 'UHC status INACTIVE'],
  ['pt-jaguar-dent', 'DENTAL_PLAN', /dental plan/, 'Cigna plan named "Dental PPO", dental STCs only'],
  ['pt-jane-doe-2001-aaa42', 'PAYER_UNAVAILABLE', /isn't responding/, 'AAA 42'],
  ['pt-jane-doe-1970-aaa43', 'CLINIC_SETUP_ISSUE', /setup issue on our end/, 'AAA 43'],
  ['pt-john-doe-1970-aaa79', 'CLINIC_SETUP_ISSUE', /setup issue on our end/, 'AAA 79'],
  ['pt-john-doe-1990-aaa72', 'PLEASE_VERIFY_DETAILS', /read it to me one more time/, 'AAA 72'],
  ['pt-john-doe-1990-aaa73', 'PLEASE_VERIFY_DETAILS', /name doesn't match/, 'AAA 73'],
  ['pt-jane-doe-1990-aaa75', 'PLEASE_VERIFY_DETAILS', /couldn't find a member/, 'AAA 75'],
];

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
