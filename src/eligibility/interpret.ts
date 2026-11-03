import type { BenefitEntry, EligibilityResponse, PayerError, Plan } from '../stedi/types.js';

/**
 * Deterministic reading of a 271 eligibility response for an eye-doctor office visit.
 * No LLM touches this: the voice model only ever reads out what this produces, so every
 * dollar figure the caller hears can be traced back to a field in the payer's response.
 */

export type VisitType = 'medical' | 'routine';

export type CopayFinding =
  | { status: 'single'; amount: number; basis: string }
  | { status: 'multiple'; options: { amount: number; basis: string }[] }
  | { status: 'none' };

export interface CoverageFacts {
  kind: 'coverage';
  active: boolean;
  status: string;
  planName?: string;
  insuranceType?: string;
  isHmo: boolean;
  isMedicare: boolean;
  dentalOnly: boolean;
  coverageStart?: string;
  coverageEnd?: string;
  visitCopay: CopayFinding;
  /** Fraction, e.g. 0.2 for 20%. In-network, for an office visit. */
  visitCoinsurance?: number;
  deductible: { total?: number; remaining?: number };
  outOfPocket: { total?: number; remaining?: number };
  outOfNetwork: { coinsurance?: number; deductible?: number };
  priorAuthRequired: boolean;
  payerMessages: string[];
}

export type ErrorCategory =
  | 'payer_unavailable'
  | 'member_id_rejected'
  | 'name_rejected'
  | 'member_not_found'
  | 'birthdate_rejected'
  | 'clinic_setup'
  | 'other';

export interface PayerErrorFacts {
  kind: 'payer_error';
  code: string;
  description: string;
  category: ErrorCategory;
}

export type EligibilityFacts = CoverageFacts | PayerErrorFacts;

const DENTAL_STCS = new Set(['35', '23', '24', '25', '26', '27', '28', '36', '37', '38', '39', '40', '41']);
const OFFICE_VISIT = '98';
const PLAN_LEVEL = '30';
const VISION = 'AL';

// Copays for these settings are not what an eye-clinic office visit costs.
const NOT_AN_OFFICE_VISIT =
  /TELE|VIRTUAL|E-?VISIT|VIDEO|URGENT|EMERGENCY|\bER\b|LAB|X-?RAY|IMAGING|RADIOLOG|CHIRO|MENTAL|BEHAV|PSYCH|SUBSTANCE|THERAP|HOSPITAL|INPATIENT|SURG|AMBULANCE|PHARM|\bRX\b|DRUG|PREVENT|WELL|ROUTINE PHYSICAL|MATERNITY|PRENATAL|ALLERG/i;
const PRIMARY_CARE = /PRIMARY|\bPCP\b|FAMILY PRACT|GENERAL PRACT|INTERNAL MED|PEDIATRIC/i;
const SPECIALIST = /SPECIALIST|SPECIALTY|\bSPC\b|\bSPEC\b|SPCLST/i;

const AAA_CATEGORIES: Record<string, ErrorCategory> = {
  '42': 'payer_unavailable',
  '80': 'payer_unavailable',
  '43': 'clinic_setup',
  '41': 'clinic_setup',
  '44': 'clinic_setup',
  '45': 'clinic_setup',
  '50': 'clinic_setup',
  '51': 'clinic_setup',
  '79': 'clinic_setup',
  '72': 'member_id_rejected',
  '73': 'name_rejected',
  '75': 'member_not_found',
  '76': 'member_not_found',
  '67': 'member_not_found',
  '71': 'birthdate_rejected',
  '58': 'birthdate_rejected',
  '62': 'other',
};

export function interpretEligibility(
  res: EligibilityResponse,
  opts: { visitType?: VisitType; today?: string } = {},
): EligibilityFacts {
  const errors = res.errors ?? [];
  if (errors.length) return toErrorFacts(errors);

  const plans = res.plans ?? [];
  const today = opts.today ?? new Date().toISOString().slice(0, 10);
  const all = <K extends keyof Plan['benefits']>(key: K) => plans.flatMap((p) => (p.benefits[key] ?? []) as BenefitEntry[]);

  const statuses = plans.flatMap((p) => p.benefits.statuses ?? []);
  const medicalStatuses = statuses.filter((s) => !isDental(s));
  const dentalStatuses = statuses.filter(isDental);
  const anyMedicalBenefit = Object.entries(plans[0]?.benefits ?? {}).some(
    ([k, v]) => k !== 'statuses' && (v ?? []).some((b) => !isDental(b)),
  );
  const dentalOnly = medicalStatuses.length === 0 && dentalStatuses.length > 0 && !anyMedicalBenefit;

  const primaryStatus =
    medicalStatuses.find((s) => s.service?.value === PLAN_LEVEL) ?? medicalStatuses[0] ?? dentalStatuses[0];
  const statusActive = primaryStatus
    ? primaryStatus.status.startsWith('ACTIVE')
    : plans.some((p) => Object.values(p.benefits).some((v) => (v ?? []).length > 0));

  const patientDates = res.dependent?.dates ?? res.subscriber?.dates;
  const coverageStart = patientDates?.plan?.start ?? patientDates?.eligibility?.start;
  const coverageEnd = patientDates?.plan?.end ?? patientDates?.eligibility?.end ?? patientDates?.policy?.end;
  const endedBeforeToday = coverageEnd !== undefined && coverageEnd < today;
  const notStartedYet = coverageStart !== undefined && coverageStart > today;

  const insuranceType = primaryStatus?.insuranceType ?? statuses.find((s) => s.insuranceType)?.insuranceType;
  const planName =
    plans.find((p) => p.name)?.name ?? primaryStatus?.planCoverageDescription ?? statuses.find((s) => s.planCoverageDescription)?.planCoverageDescription;

  const copays = all('coPayment');
  const coins = all('coInsurance');

  return {
    kind: 'coverage',
    active: statusActive && !endedBeforeToday && !notStartedYet,
    status: endedBeforeToday ? 'ENDED' : notStartedYet ? 'NOT_STARTED' : (primaryStatus?.status ?? (statusActive ? 'ACTIVE_COVERAGE' : 'UNKNOWN')),
    planName,
    insuranceType,
    isHmo: /HMO|HEALTH_MAINTENANCE/i.test(insuranceType ?? '') || /\bHMO\b/i.test(planName ?? ''),
    isMedicare: /MEDICARE/i.test(insuranceType ?? '') || res.payerId === 'CMS',
    dentalOnly,
    coverageStart,
    coverageEnd,
    visitCopay: pickVisitCopay(copays, opts.visitType ?? 'medical'),
    visitCoinsurance: pickVisitPercent(coins),
    deductible: pickAccumulator(all('deductible'), 'in'),
    outOfPocket: pickAccumulator(all('outOfPocket'), 'in'),
    outOfNetwork: {
      coinsurance: pickVisitPercent(coins, 'out'),
      deductible: pickAccumulator(all('deductible'), 'out').total,
    },
    priorAuthRequired: [...copays, ...coins].some(
      (b) => isOfficeVisitService(b) && b.priorAuthIndicator === 'REQUIRED',
    ),
    payerMessages: [...new Set(statuses.flatMap((s) => s.messages ?? []))].slice(0, 6),
  };
}

function toErrorFacts(errors: PayerError[]): PayerErrorFacts {
  // When several AAA errors come back, the most actionable one wins.
  const ranked = [...errors].sort((a, b) => rank(category(a)) - rank(category(b)));
  const top = ranked[0]!;
  return { kind: 'payer_error', code: top.code, description: top.description, category: category(top) };
}

function category(e: PayerError): ErrorCategory {
  return AAA_CATEGORIES[e.code] ?? 'other';
}

function rank(c: ErrorCategory): number {
  return ['member_id_rejected', 'name_rejected', 'birthdate_rejected', 'member_not_found', 'payer_unavailable', 'clinic_setup', 'other'].indexOf(c);
}

function isDental(b: BenefitEntry): boolean {
  return b.service?.system !== 'CPT' && b.service?.value !== undefined && DENTAL_STCS.has(b.service.value) || b.service?.system === 'CDT';
}

function network(b: BenefitEntry): 'in' | 'out' | 'both' | 'unknown' {
  switch (b.network?.indicator) {
    case 'IN_NETWORK':
      return 'in';
    case 'OUT_OF_NETWORK':
      return 'out';
    case 'IN_AND_OUT_OF_NETWORK':
      return 'both';
    default:
      return 'unknown';
  }
}

function appliesTo(b: BenefitEntry, side: 'in' | 'out'): boolean {
  const n = network(b);
  return n === side || n === 'both' || (side === 'in' && n === 'unknown');
}

function text(b: BenefitEntry): string {
  return [...(b.messages ?? []), b.planCoverageDescription ?? ''].join(' ').toUpperCase();
}

function stc(b: BenefitEntry): string | undefined {
  return !b.service?.system || b.service.system === 'STC' ? b.service?.value : undefined;
}

function isPersonLevel(b: BenefitEntry): boolean {
  return !b.coverageLevel || !/FAMILY/.test(b.coverageLevel);
}

function isOfficeVisitService(b: BenefitEntry): boolean {
  const code = stc(b);
  return code === OFFICE_VISIT || code === PLAN_LEVEL;
}

function money(v: string | undefined): number | undefined {
  if (v === undefined || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Which copay applies when an ophthalmologist sees this patient in the office?
 * Ophthalmologists bill as specialists, so we look for (in order):
 *   1. office-visit (STC 98) copays the payer labels as specialist
 *   2. office-visit copays with no primary-care label
 *   3. a plan-level (STC 30) copay
 * For routine eye exams we first check the vision (STC AL) benefit.
 * The first tier with data wins. If that tier holds several different amounts we
 * report all of them rather than pick one: a wrong copay is worse than "let me confirm".
 */
export function pickVisitCopay(copays: BenefitEntry[], visitType: VisitType): CopayFinding {
  const usable = copays.filter(
    (b) => appliesTo(b, 'in') && isPersonLevel(b) && !NOT_AN_OFFICE_VISIT.test(text(b)) && money(b.amount) !== undefined,
  );

  const tiers: { basis: string; entries: BenefitEntry[] }[] = [
    ...(visitType === 'routine' ? [{ basis: 'routine vision exam', entries: usable.filter((b) => stc(b) === VISION) }] : []),
    { basis: 'specialist office visit', entries: usable.filter((b) => stc(b) === OFFICE_VISIT && SPECIALIST.test(text(b))) },
    { basis: 'office visit', entries: usable.filter((b) => stc(b) === OFFICE_VISIT && !PRIMARY_CARE.test(text(b)) && !SPECIALIST.test(text(b))) },
    { basis: 'plan copay', entries: usable.filter((b) => stc(b) === PLAN_LEVEL && !PRIMARY_CARE.test(text(b))) },
  ];

  for (const tier of tiers) {
    if (!tier.entries.length) continue;
    const office = tier.entries.filter((b) => b.placesOfService?.some((p) => p.code === '11'));
    const pool = office.length ? office : tier.entries;
    const amounts = [...new Set(pool.map((b) => money(b.amount)!))].sort((a, b) => a - b);
    if (amounts.length === 1) return { status: 'single', amount: amounts[0]!, basis: tier.basis };
    return {
      status: 'multiple',
      options: amounts.map((amount) => ({
        amount,
        basis: pool.find((b) => money(b.amount) === amount)?.messages?.join('; ') || tier.basis,
      })),
    };
  }
  return { status: 'none' };
}

function pickVisitPercent(coins: BenefitEntry[], side: 'in' | 'out' = 'in'): number | undefined {
  const usable = coins.filter(
    (b) => (side === 'in' ? appliesTo(b, 'in') : network(b) === 'out' || network(b) === 'both') &&
      isPersonLevel(b) && !NOT_AN_OFFICE_VISIT.test(text(b)) && money(b.percent) !== undefined,
  );
  const ordered = [
    ...usable.filter((b) => stc(b) === OFFICE_VISIT && !PRIMARY_CARE.test(text(b))),
    ...usable.filter((b) => stc(b) === PLAN_LEVEL),
  ];
  const value = money(ordered[0]?.percent);
  if (value === undefined) return undefined;
  return value > 1 ? value / 100 : value; // some payers send "20" instead of "0.2"
}

function pickAccumulator(entries: BenefitEntry[], side: 'in' | 'out'): { total?: number; remaining?: number } {
  const usable = entries.filter(
    (b) => (side === 'in' ? appliesTo(b, 'in') : network(b) === 'out') &&
      (stc(b) === PLAN_LEVEL || stc(b) === undefined) &&
      !/FAMILY/.test(b.coverageLevel ?? ''),
  );
  const remaining = usable.find((b) => /REMAINING/.test(b.timePeriod ?? ''));
  const total = usable.find((b) => !/REMAINING|TO_DATE/.test(b.timePeriod ?? ''));
  return { total: money(total?.amount), remaining: money(remaining?.amount) };
}
