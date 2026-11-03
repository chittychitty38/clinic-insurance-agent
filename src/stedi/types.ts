/**
 * The subset of Stedi's Real-Time Eligibility Check (2026-06-01, `plans` shape) we rely on.
 * Full schema: https://www.stedi.com/docs/healthcare/api-reference/post-eligibility-check
 */

export interface PersonName {
  person?: { firstName?: string; lastName?: string; middleName?: string };
  organization?: string;
}

export interface EligibilityRequest {
  payerId: string;
  externalPatientId?: string;
  provider: { name: { organization: string }; npi: string };
  subscriber: { name: PersonName; memberId: string; dateOfBirth?: string };
  dependent?: { name: PersonName; dateOfBirth: string };
  encounter: { services: { system: 'STC'; value: string }[]; dates?: { service: { start: string } } };
}

export interface DateRange { start?: string; end?: string }

export interface ServiceRef { system?: string; value?: string; definition?: string }

export interface BenefitEntry {
  /** Only on `statuses` entries, e.g. ACTIVE_COVERAGE or INACTIVE. */
  status?: string;
  amount?: string;
  percent?: string;
  coverageLevel?: string;
  insuranceType?: string;
  network?: { indicator?: string };
  service?: ServiceRef;
  timePeriod?: string;
  messages?: string[];
  planCoverageDescription?: string;
  placesOfService?: { code?: string; definition?: string }[];
  priorAuthIndicator?: string;
  dates?: { benefit?: DateRange };
  quantity?: { qualifier?: string; value?: string };
}

export interface StatusEntry extends BenefitEntry {
  status: string;
}

export interface Plan {
  name?: string;
  benefits: {
    statuses?: StatusEntry[];
    coPayment?: BenefitEntry[];
    coInsurance?: BenefitEntry[];
    deductible?: BenefitEntry[];
    outOfPocket?: BenefitEntry[];
    limitations?: BenefitEntry[];
    nonCovered?: BenefitEntry[];
    exclusions?: BenefitEntry[];
    primaryCareProvider?: BenefitEntry[];
    [key: string]: BenefitEntry[] | undefined;
  };
}

export interface PayerError {
  code: string;
  description: string;
  followupAction: string;
  location: string;
  possibleResolutions?: string;
}

export interface PatientInfo {
  memberId?: string;
  dateOfBirth?: string;
  name?: PersonName;
  dates?: { plan?: DateRange; eligibility?: DateRange; policy?: DateRange; [k: string]: DateRange | undefined };
  relationToSubscriber?: string;
}

export interface EligibilityResponse {
  id?: string;
  payerId?: string;
  payer?: { name?: PersonName };
  subscriber?: PatientInfo;
  dependent?: PatientInfo;
  plans?: Plan[];
  errors?: PayerError[];
  message?: string;
  x12?: string;
}
