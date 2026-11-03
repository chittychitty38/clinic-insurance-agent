import { describe, expect, it } from 'vitest';
import { interpretEligibility, pickVisitCopay } from '../src/eligibility/interpret.js';
import { buildAnswer } from '../src/eligibility/script.js';
import { payerByKey } from '../src/payers.js';
import type { BenefitEntry, EligibilityResponse } from '../src/stedi/types.js';

const stc = (value: string) => ({ system: 'STC', value });
const inNet = { indicator: 'IN_NETWORK' };

describe('picking the office-visit copay', () => {
  it('prefers the specialist copay over primary care', () => {
    const copays: BenefitEntry[] = [
      { amount: '20', service: stc('98'), network: inNet, messages: ['PRIMARY CARE PHYSICIAN'] },
      { amount: '50', service: stc('98'), network: inNet, messages: ['SPECIALIST'] },
      { amount: '250', service: stc('86'), network: inNet, messages: ['EMERGENCY ROOM'] },
    ];
    expect(pickVisitCopay(copays, 'medical')).toEqual({ status: 'single', amount: 50, basis: 'specialist' });
  });

  it('never uses a PCP-only copay for an eye-doctor visit', () => {
    const copays: BenefitEntry[] = [{ amount: '20', service: stc('98'), network: inNet, messages: ['PCP OFFICE VISIT'] }];
    expect(pickVisitCopay(copays, 'medical')).toEqual({ status: 'none' });
  });

  it('ignores out-of-network and telehealth copays', () => {
    const copays: BenefitEntry[] = [
      { amount: '0', service: stc('98'), network: inNet, messages: ['TELEHEALTH SPECIALIST'] },
      { amount: '90', service: stc('98'), network: { indicator: 'OUT_OF_NETWORK' }, messages: ['SPECIALIST'] },
      { amount: '40', service: stc('98'), network: inNet },
    ];
    expect(pickVisitCopay(copays, 'medical')).toEqual({ status: 'single', amount: 40, basis: 'office' });
  });

  it('reports every amount instead of guessing when the plan lists several', () => {
    const copays: BenefitEntry[] = [
      { amount: '30', service: stc('98'), network: inNet, messages: ['SPECIALIST TIER 1'] },
      { amount: '60', service: stc('98'), network: inNet, messages: ['SPECIALIST TIER 2'] },
    ];
    const r = pickVisitCopay(copays, 'medical');
    expect(r.status).toBe('multiple');
  });

  it('narrows to office place of service when the payer splits by location', () => {
    const copays: BenefitEntry[] = [
      { amount: '45', service: stc('98'), network: inNet, messages: ['SPECIALIST'], placesOfService: [{ code: '11' }] },
      { amount: '100', service: stc('98'), network: inNet, messages: ['SPECIALIST'], placesOfService: [{ code: '22' }] },
    ];
    expect(pickVisitCopay(copays, 'medical')).toMatchObject({ status: 'single', amount: 45 });
  });

  it('checks the vision benefit first for a routine exam', () => {
    const copays: BenefitEntry[] = [
      { amount: '10', service: stc('AL'), network: inNet },
      { amount: '50', service: stc('98'), network: inNet, messages: ['SPECIALIST'] },
    ];
    expect(pickVisitCopay(copays, 'routine')).toMatchObject({ amount: 10 });
    expect(pickVisitCopay(copays, 'medical')).toMatchObject({ amount: 50 });
  });
});

describe('coverage status', () => {
  const base = (status: string, extra: Partial<EligibilityResponse> = {}): EligibilityResponse => ({
    plans: [{ benefits: { statuses: [{ status, service: stc('30') }], coPayment: [{ amount: '35', service: stc('98'), network: inNet, messages: ['SPECIALIST'] }] } }],
    ...extra,
  });

  it('active plan, in network: says the copay', () => {
    const facts = interpretEligibility(base('ACTIVE_COVERAGE'), { asOf: '2026-11-02' });
    const a = buildAnswer(facts, { payer: payerByKey('aetna')!, firstName: 'Jordan', visitType: 'medical', priorFailures: 0 });
    expect(a.outcome).toBe('ACCEPTED');
    expect(a.say).toContain('35 dollars');
  });

  it('inactive plan is never reported as accepted', () => {
    const facts = interpretEligibility(base('INACTIVE'), { asOf: '2026-11-02' });
    const a = buildAnswer(facts, { payer: payerByKey('uhc')!, firstName: 'Jane', visitType: 'medical', priorFailures: 0 });
    expect(a.outcome).toBe('COVERAGE_INACTIVE');
    expect(a.say).not.toMatch(/dollars/);
  });

  it('a plan that ended before today is inactive even if the payer says active', () => {
    const facts = interpretEligibility(base('ACTIVE_COVERAGE', { subscriber: { dates: { plan: { start: '2024-01-01', end: '2025-12-31' } } } }), { asOf: '2026-11-02' });
    expect(facts.kind === 'coverage' && facts.active).toBe(false);
  });

  it('active coverage with an out-of-network payer is not "accepted"', () => {
    const facts = interpretEligibility(base('ACTIVE_COVERAGE'), { asOf: '2026-11-02' });
    const a = buildAnswer(facts, { payer: payerByKey('kaiser')!, firstName: 'Jane', visitType: 'medical', priorFailures: 0 });
    expect(a.outcome).toBe('NOT_IN_NETWORK');
    expect(a.say).toContain('self-pay');
  });

  it('payer errors map to a safe next step', () => {
    const facts = interpretEligibility({ errors: [{ code: '72', description: 'Invalid/Missing Subscriber/Insured ID', followupAction: 'Please Correct and Resubmit', location: 'SUBSCRIBER' }] });
    const first = buildAnswer(facts, { payer: payerByKey('uhc')!, firstName: 'John', visitType: 'medical', priorFailures: 0 });
    const second = buildAnswer(facts, { payer: payerByKey('uhc')!, firstName: 'John', visitType: 'medical', priorFailures: 1 });
    expect(first.say).toMatch(/read it to me one more time/);
    expect(second.next_step).toMatch(/request_callback/);
  });

  it('adds the refraction heads-up for routine exams', () => {
    const facts = interpretEligibility(base('ACTIVE_COVERAGE'), { asOf: '2026-11-02', visitType: 'routine' });
    const a = buildAnswer(facts, { payer: payerByKey('aetna')!, firstName: 'Jordan', visitType: 'routine', priorFailures: 0 });
    expect(a.say).toMatch(/refraction/);
  });
});

describe('vision plans (eye care has two kinds of insurance)', () => {
  it('routine exam with VSP: in network, copay confirmed by staff instead of guessed', async () => {
    const { visionPlanAnswer } = await import('../src/eligibility/script.js');
    const a = visionPlanAnswer(payerByKey('vsp')!, 'routine');
    expect(a.outcome).toBe('ACCEPTED_COPAY_UNCONFIRMED');
    expect(a.say).not.toMatch(/\d+ dollars/);
  });
  it('medical visit with a VSP card: asks for the medical card', async () => {
    const { visionPlanAnswer } = await import('../src/eligibility/script.js');
    expect(visionPlanAnswer(payerByKey('eyemed')!, 'medical').outcome).toBe('VISION_PLAN');
  });
});
