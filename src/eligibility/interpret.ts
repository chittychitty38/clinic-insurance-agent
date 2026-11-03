import type { BenefitEntry, EligibilityResponse, PayerError, Plan, StatusEntry } from '../stedi/types.js';

/**
 * Deterministic reading of a 271 eligibility response for an eye-doctor office visit.
 * No LLM touches this: the voice model only ever reads out what this produces, so every
 * dollar figure the caller hears traces back to a field in the payer's response.
 *
 * Every rule below was calibrated against real Stedi sandbox responses (test/fixtures/).
 */

export type VisitType = 'medical' | 'routine';

export type CopayFinding =
  | { status: 'single'; amount: number; basis: CopayBasis }
  | { status: 'multiple'; options: { amount: number; label: string }[] }
  | { status: 'none' };

export type CopayBasis = 'specialist' | 'office' | 'plan' | 'vision';

export interface CoverageFacts {
  kind: 'coverage';
  active: boolean;
  status: string;
  /** Payer status says active but the plan dates say it ended (or hasn't started). */
  datesConflict: boolean;
  /** The payer itself told us the requesting provider is out of network for this member. */
  payerSaysOutOfNetwork: boolean;
  planName?: string;
  insuranceType?: string;
  isHmo: boolean;
  referralRequired: boolean;
  isMedicare: boolean;
  /** Qualified Medicare Beneficiary: Medicaid pays the Medicare cost-sharing; patient owes nothing. */
  isQmb: boolean;
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

export interface InterpretOptions {
  visitType?: VisitType;
  /** YYYY-MM-DD the coverage must be valid on. Defaults to today. */
  asOf?: string;
  /**
   * Treat "payer says active, but plan dates ended" as a conflict to escalate.
   * Off in the Stedi sandbox, whose mock responses are frozen with 2024 plan dates.
   */
  enforcePlanDates?: boolean;
  /** Network names the clinic participates in for this payer, e.g. ["PAR"]. */
  clinicNetworks?: string[];
}

const DENTAL_STCS = new Set(['35', '23', '24', '25', '26', '27', '28', '36', '37', '38', '39', '40', '41']);
/** STCs a dental plan also reports that don't make it a medical plan. */
const NEUTRAL_STCS = new Set(['30', '4', '7']);
const PLAN_LEVEL = '30';
const VISION = 'AL';
/** 98 = Professional (Physician) Visit - Office; BY = Physician Visit - Office: Sick. */
const OFFICE_VISIT_STCS = new Set(['98', 'BY']);

// The label vocabulary below comes from every message on office-visit benefits across the
// sandbox payers (Aetna, Anthem, BCBS TX, Cigna, Humana, Kaiser, Oscar, UHC, CMS).

// A label naming one of these settings/services is not what an eye-clinic office visit costs.
const NOT_AN_OFFICE_VISIT =
  /TELE|VIRTUAL|TELADOC|E-?VISIT|VIDEO|URGENT|WALK.?IN|RETAIL|CONVENIENCE|EMERGENCY|\bER\b|LAB\b|X-?RAY|IMAGING|RADIOLOG|\bRAD\b|CHIRO|MENTAL|BEHAV|PSYCH|SUBSTANCE|COGNITIVE|THERAP|REHAB|HOSPITAL|INPATIENT|SURG|PROCEDURE|AMBULANCE|PHARM|\bRX\b|DRUG|PREVENT|WELL|PERIODIC HEALTH|PHYSICAL HISTORY|MATERNITY|PRENATAL|ALLERG|GYN|ABORTION|FAMILY PLANNING|TRANSGENDER|DIALYSIS|CONTACTS|FRAMES|LENS|SPECIFIC NETWORK|CONTRACTED VENDOR/;
// Labels that describe the benefit's bookkeeping, not the service: ignored when classifying.
const BOILERPLATE =
  /^(IN NETWORK|MOOP|PER VISIT|ROUTINE|ALL OTHER IN-NETWORK PROVIDERS|OUTPATIENT SERVICES)$|^ADJ LEVEL|INCLUDED IN OOP|OUT-OF-POCKET MAXIMUM|INCLUDED FOR SPECIFIC SERVICES$/;
const PRIMARY_CARE = /PRIMARY|\bPCP\b|FAMILY PRACT|GENERAL PRACT|GENERAL MEDICINE|INTERNAL MED|PEDIATRIC/;
const SPECIALIST = /SPECIALIST|SPECIALTY/;
const NETWORK_LABEL = /^([A-Z]+) NETWORK$/;
const PAYER_SAYS_OON = /PROVIDER IS OUT[- ]?(OF[- ])?NETWORK|NON[- ]?AFFILIATED PROVIDER|OUT[- ]OF[- ]NETWORK FOR (THE )?MEMBER/;
const REFERRAL_REQUIRED = /REFERRAL (IS )?REQUIRED|SUBMIT A SPECIALIST REFERRAL|REFERRAL NEEDED|REQUIRES? (A )?REFERRAL/;

const AAA_CATEGORIES: Record<string, ErrorCategory> = {
  '42': 'payer_unavailable',
  '80': 'payer_unavailable',
  '41': 'clinic_setup',
  '43': 'clinic_setup',
  '44': 'clinic_setup',
  '45': 'clinic_setup',
  '50': 'clinic_setup',
  '51': 'clinic_setup',
  '79': 'clinic_setup',
  '72': 'member_id_rejected',
  '73': 'name_rejected',
  '58': 'birthdate_rejected',
  '71': 'birthdate_rejected',
  '67': 'member_not_found',
  '75': 'member_not_found',
  '76': 'member_not_found',
};

export function interpretEligibility(res: EligibilityResponse, opts: InterpretOptions = {}): EligibilityFacts {
  if (res.errors?.length) return toErrorFacts(res.errors);

  const plans = res.plans ?? [];
  const asOf = opts.asOf ?? new Date().toISOString().slice(0, 10);
  const all = (key: keyof Plan['benefits']) => plans.flatMap((p) => (p.benefits[key] ?? []) as BenefitEntry[]);
  const statuses = plans.flatMap((p) => p.benefits.statuses ?? []) as StatusEntry[];

  const isMedicare = res.payerId === 'CMS' || statuses.some((s) => /MEDICARE_PART/.test(s.insuranceType ?? ''));
  const primary = primaryStatus(statuses, isMedicare);
  const statusActive = primary
    ? primary.status.startsWith('ACTIVE')
    : plans.some((p) => Object.values(p.benefits).some((v) => (v ?? []).length > 0)); // benefits imply coverage

  const dates = res.dependent?.dates ?? res.subscriber?.dates;
  const coverageStart = dates?.plan?.start ?? dates?.eligibility?.start;
  const coverageEnd = dates?.plan?.end ?? dates?.eligibility?.end;
  const datesOutOfRange = (coverageEnd !== undefined && coverageEnd < asOf) || (coverageStart !== undefined && coverageStart > asOf);
  // The payer's status is authoritative for the date it evaluated. If its own plan dates
  // contradict an ACTIVE status, that's not something to guess about: escalate.
  const datesConflict = statusActive && datesOutOfRange && (opts.enforcePlanDates ?? true);

  const planName = plans.find((p) => p.name)?.name ?? primary?.planCoverageDescription;
  const insuranceType = primary?.insuranceType ?? statuses.find((s) => s.insuranceType)?.insuranceType;
  const everyMessage = [...statuses, ...all('coPayment'), ...all('coInsurance')].flatMap((b) => b.messages ?? []).join(' | ').toUpperCase();

  const medicalStcs = statuses.map(stc).filter((c): c is string => !!c && !DENTAL_STCS.has(c) && !NEUTRAL_STCS.has(c));
  const dentalOnly = /DENTAL/i.test(planName ?? '') || (statuses.some(isDental) && medicalStcs.length === 0);

  const copays = all('coPayment');
  const coins = all('coInsurance');
  const qmbCoins = coins.find((b) => /QUALIFIED_MEDICARE_BENEFICIARY/.test(b.insuranceType ?? ''));

  return {
    kind: 'coverage',
    active: statusActive && !datesConflict,
    status: datesConflict ? 'DATES_CONFLICT' : (primary?.status ?? (statusActive ? 'ACTIVE_COVERAGE' : 'UNKNOWN')),
    datesConflict,
    payerSaysOutOfNetwork: PAYER_SAYS_OON.test(everyMessage),
    planName,
    insuranceType,
    isHmo: /HMO|HEALTH_MAINTENANCE/i.test(insuranceType ?? '') || /\bHMO\b/i.test(`${planName ?? ''} ${primary?.messages?.join(' ') ?? ''}`),
    referralRequired: REFERRAL_REQUIRED.test(everyMessage),
    isMedicare,
    isQmb: !!qmbCoins,
    dentalOnly,
    coverageStart,
    coverageEnd,
    visitCopay: pickVisitCopay(copays, opts.visitType ?? 'medical', opts.clinicNetworks),
    visitCoinsurance: isMedicare && qmbCoins ? money(qmbCoins.percent) : pickVisitPercent(coins, opts.clinicNetworks),
    deductible: pickAccumulator(all('deductible'), 'in'),
    outOfPocket: pickAccumulator(all('outOfPocket'), 'in'),
    outOfNetwork: {
      coinsurance: pickVisitPercent(coins.filter((b) => network(b) === 'out')),
      deductible: pickAccumulator(all('deductible'), 'out').total,
    },
    priorAuthRequired: [...copays, ...coins].some((b) => OFFICE_VISIT_STCS.has(stc(b) ?? '') && b.priorAuthIndicator === 'REQUIRED'),
  };
}

/** For Medicare, office visits are Part B. Otherwise prefer an ACTIVE plan-level (STC 30) status. */
function primaryStatus(statuses: StatusEntry[], isMedicare: boolean): StatusEntry | undefined {
  const pool = isMedicare ? statuses.filter((s) => s.insuranceType === 'MEDICARE_PART_B') : statuses.filter((s) => !isDental(s));
  const planLevel = pool.filter((s) => stc(s) === PLAN_LEVEL);
  return planLevel.find((s) => s.status.startsWith('ACTIVE')) ?? planLevel[0] ?? pool[0] ?? statuses[0];
}

function toErrorFacts(errors: PayerError[]): PayerErrorFacts {
  // Several AAA errors can come back; the one the caller can fix comes first.
  const order: ErrorCategory[] = ['member_id_rejected', 'name_rejected', 'birthdate_rejected', 'member_not_found', 'payer_unavailable', 'clinic_setup', 'other'];
  const cat = (e: PayerError) => AAA_CATEGORIES[e.code] ?? 'other';
  const top = [...errors].sort((a, b) => order.indexOf(cat(a)) - order.indexOf(cat(b)))[0]!;
  return { kind: 'payer_error', code: top.code, description: top.description, category: cat(top) };
}

function stc(b: BenefitEntry): string | undefined {
  return !b.service?.system || b.service.system === 'STC' ? b.service?.value : undefined;
}

function isDental(b: BenefitEntry): boolean {
  return b.service?.system === 'CDT' || DENTAL_STCS.has(stc(b) ?? '');
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

const inNetwork = (b: BenefitEntry) => network(b) !== 'out';

function money(v: string | undefined): number | undefined {
  if (v === undefined || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Payers pack several service labels into one entry, e.g. Oscar's
 * "TELEHEALTH SPECIALIST,VISIT OFFICE SPECIALIST" or Kaiser's "..._Specialty Care_In Network_...".
 * We judge each label on its own.
 */
function labels(b: BenefitEntry): string[] {
  return (b.messages ?? []).flatMap((m) => m.split(/[,;_]+/)).map((s) => s.trim().toUpperCase()).filter(Boolean);
}

type Tier = 'specialist' | 'office' | 'skip';

/** Labels that say what service the benefit covers (bookkeeping and network names removed). */
function serviceLabels(b: BenefitEntry): string[] {
  return labels(b).filter((l) => !BOILERPLATE.test(l) && !NETWORK_LABEL.test(l));
}

/**
 * specialist: some label names specialist care in a normal setting ("SPECIALIST VISIT OR EVALUATION").
 * office:     no service labels, or a generic office one ("OFFICE VISITS"), and nothing primary-care.
 * skip:       primary-care-only, or only excluded settings. A PCP copay is never quoted for an eye doctor.
 * One entry can cover several services at one price (Aetna: "Office Visits, Walk in Clinic,
 * Mental Health" $30), so a single qualifying label is enough.
 */
function tierOf(b: BenefitEntry): Tier {
  const ls = serviceLabels(b).filter((l) => !NOT_AN_OFFICE_VISIT.test(l));
  if (ls.some((l) => SPECIALIST.test(l))) return 'specialist';
  if (ls.some((l) => PRIMARY_CARE.test(l))) return 'skip';
  if (ls.length > 0 || serviceLabels(b).length === 0) return 'office';
  return 'skip';
}

/**
 * A benefit that lists only specific non-office places (02/10 telehealth, 21-23 hospital, ...) isn't
 * for an office visit. POS 11 is the office; POS 99 is CMS's catch-all "other place of service",
 * which Cigna uses for its general specialist copay, so it stays in.
 */
function atOffice(b: BenefitEntry): boolean {
  return !b.placesOfService?.length || b.placesOfService.some((p) => p.code === '11' || p.code === '99');
}

/** Anthem lists "SPECIALIST, EPO NETWORK" $30 and "SPECIALIST, PAR NETWORK" $45: keep the network we're in. */
function inClinicNetwork(b: BenefitEntry, clinicNetworks?: string[]): boolean {
  if (!clinicNetworks?.length) return true;
  const named = labels(b).map((l) => l.match(NETWORK_LABEL)?.[1]).filter((x): x is string => !!x && !['IN', 'OUT', 'ALL'].includes(x));
  return named.length === 0 || named.some((n) => clinicNetworks.includes(n));
}

/**
 * Which copay applies when an ophthalmologist sees this patient in the office? In order:
 *   routine exam only: the vision benefit (STC AL)
 *   1. office-visit copays (STC 98 / BY) labelled specialist
 *   2. office-visit copays with no service label
 *   3. a plan-level (STC 30) copay with no primary-care label
 * The first tier with data wins. If it holds several different amounts we report all of
 * them instead of choosing: a wrong copay is worse than "let me confirm that for you".
 */
export function pickVisitCopay(copays: BenefitEntry[], visitType: VisitType, clinicNetworks?: string[]): CopayFinding {
  const usable = copays.filter((b) => inNetwork(b) && atOffice(b) && money(b.amount) !== undefined && inClinicNetwork(b, clinicNetworks));
  const office = usable.filter((b) => OFFICE_VISIT_STCS.has(stc(b) ?? ''));

  const tiers: { basis: CopayBasis; entries: BenefitEntry[] }[] = [
    ...(visitType === 'routine' ? [{ basis: 'vision' as const, entries: usable.filter((b) => stc(b) === VISION && !NOT_AN_OFFICE_VISIT.test(labels(b).join(' '))) }] : []),
    { basis: 'specialist', entries: office.filter((b) => tierOf(b) === 'specialist') },
    { basis: 'office', entries: office.filter((b) => tierOf(b) === 'office') },
    { basis: 'plan', entries: usable.filter((b) => stc(b) === PLAN_LEVEL && tierOf(b) !== 'skip') },
  ];

  for (const tier of tiers) {
    if (!tier.entries.length) continue;
    const pool = narrowToOffice(preferIndividual(tier.entries));
    const amounts = [...new Set(pool.map((b) => money(b.amount)!))].sort((a, b) => a - b);
    if (amounts.length === 1) return { status: 'single', amount: amounts[0]!, basis: tier.basis };
    return {
      status: 'multiple',
      options: amounts.map((amount) => ({ amount, label: pool.find((b) => money(b.amount) === amount)?.messages?.join('; ') ?? tier.basis })),
    };
  }
  return { status: 'none' };
}

function preferIndividual(entries: BenefitEntry[]): BenefitEntry[] {
  const individual = entries.filter((b) => !/FAMILY/.test(b.coverageLevel ?? ''));
  return individual.length ? individual : entries;
}

/** POS 11 = office. If the payer splits a benefit by place of service, the office one is ours. */
function narrowToOffice(entries: BenefitEntry[]): BenefitEntry[] {
  const office = entries.filter((b) => b.placesOfService?.some((p) => p.code === '11'));
  return office.length ? office : entries;
}

function pickVisitPercent(coins: BenefitEntry[], clinicNetworks?: string[]): number | undefined {
  const usable = coins.filter((b) => money(b.percent) !== undefined && atOffice(b) && inClinicNetwork(b, clinicNetworks));
  const inNet = usable.some((b) => network(b) !== 'out') ? usable.filter(inNetwork) : usable;
  const office = inNet.filter((b) => OFFICE_VISIT_STCS.has(stc(b) ?? ''));
  const tiers = [
    office.filter((b) => tierOf(b) === 'specialist'),
    office.filter((b) => tierOf(b) === 'office'),
    inNet.filter((b) => stc(b) === PLAN_LEVEL && tierOf(b) !== 'skip'),
  ];
  const tier = tiers.find((t) => t.length);
  const value = tier ? money(narrowToOffice(preferIndividual(tier))[0]?.percent) : undefined;
  if (value === undefined) return undefined;
  return value > 1 ? value / 100 : value; // some payers send "20" instead of "0.2"
}

function pickAccumulator(entries: BenefitEntry[], side: 'in' | 'out'): { total?: number; remaining?: number } {
  const usable = entries.filter(
    (b) =>
      (side === 'in' ? inNetwork(b) : network(b) === 'out') &&
      (stc(b) === PLAN_LEVEL || stc(b) === undefined) &&
      !/FAMILY/.test(b.coverageLevel ?? '') &&
      !/QUALIFIED_MEDICARE_BENEFICIARY/.test(b.insuranceType ?? ''),
  );
  // Prefer the strictly in-network figure over a combined in-and-out one.
  const ordered = side === 'in' ? [...usable.filter((b) => network(b) === 'in'), ...usable.filter((b) => network(b) !== 'in')] : usable;
  const remaining = ordered.find((b) => b.timePeriod === 'REMAINING');
  const total = ordered.find((b) => b.timePeriod && /YEAR$|CONTRACT|PLAN|SERVICE_YEAR|LIFETIME/.test(b.timePeriod) && b.timePeriod !== 'YEAR_TO_DATE');
  return { total: money(total?.amount), remaining: money(remaining?.amount) };
}
