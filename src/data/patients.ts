/**
 * The clinic's patient list for the demo. Every record mirrors one of Stedi's sandbox
 * mock patients (https://www.stedi.com/docs/healthcare/api-reference/mock-requests-eligibility-checks),
 * because the sandbox only answers for those exact names, birthdates and member IDs.
 *
 * In production this comes from the practice-management system / EHR (ModMed, Nextech, etc.).
 * `scenario` is for the dashboard and eval only; the agent never sees it.
 */
export interface Person {
  firstName: string;
  lastName: string;
  dateOfBirth?: string;
}

export interface CoverageOnFile {
  payerKey: string;
  memberId: string;
  /** Who the patient is to the policyholder. 'self' = the patient is the subscriber. */
  relationship: 'self' | 'child' | 'spouse';
  policyholder?: Person;
}

export interface Patient {
  id: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  phone: string;
  coverage: CoverageOnFile;
  scenario: string;
}

const doe = (first: string): Person => ({ firstName: first, lastName: 'Doe' });

export const PATIENTS: Patient[] = [
  // Students and family members covered on someone else's plan
  { id: 'pt-jordan-doe-2001', firstName: 'Jordan', lastName: 'Doe', dateOfBirth: '2001-07-14', phone: '+15550100101', coverage: { payerKey: 'aetna', memberId: 'AETNA9wcSu', relationship: 'child', policyholder: doe('John') }, scenario: 'Active: Aetna, student on a parent\'s plan' },
  { id: 'pt-jordan-doe-2015', firstName: 'Jordan', lastName: 'Doe', dateOfBirth: '2015-09-20', phone: '+15550100102', coverage: { payerKey: 'cigna', memberId: 'CIGNAJTUxNm', relationship: 'child', policyholder: doe('John') }, scenario: 'Active: Cigna, child on a parent\'s plan' },
  { id: 'pt-john-doe-1975', firstName: 'John', lastName: 'Doe', dateOfBirth: '1975-01-01', phone: '+15550100103', coverage: { payerKey: 'anthem-ca', memberId: 'CGMBCBSCA123', relationship: 'spouse', policyholder: doe('Jane') }, scenario: 'Active: Anthem Blue Cross, spouse\'s plan' },
  { id: 'pt-jane-doe-2015', firstName: 'Jane', lastName: 'Doe', dateOfBirth: '2015-01-01', phone: '+15550100104', coverage: { payerKey: 'bcbs-tx', memberId: 'A2CBCBSTX123', relationship: 'child', policyholder: doe('John') }, scenario: 'Active: BCBS Texas, child on a parent\'s plan' },
  { id: 'pt-jane-doe-2001-oscar', firstName: 'Jane', lastName: 'Doe', dateOfBirth: '2001-01-01', phone: '+15550100105', coverage: { payerKey: 'oscar', memberId: 'OSCAR123456', relationship: 'child', policyholder: doe('John') }, scenario: 'Active: Oscar, student on a parent\'s plan' },
  { id: 'pt-jane-doe-1952', firstName: 'Jane', lastName: 'Doe', dateOfBirth: '1952-11-21', phone: '+15550100106', coverage: { payerKey: 'uhc', memberId: 'UHC202649', relationship: 'spouse', policyholder: doe('John') }, scenario: 'Active: UnitedHealthcare, spouse\'s plan' },

  // Patients who hold their own policy
  { id: 'pt-jane-doe-2004', firstName: 'Jane', lastName: 'Doe', dateOfBirth: '2004-04-04', phone: '+15550100107', coverage: { payerKey: 'aetna', memberId: 'AETNA12345', relationship: 'self' }, scenario: 'Active: Aetna, own policy' },
  { id: 'pt-james-jones', firstName: 'James', lastName: 'Jones', dateOfBirth: '1991-02-02', phone: '+15550100108', coverage: { payerKey: 'cigna', memberId: '23456789100', relationship: 'self' }, scenario: 'Active: Cigna' },
  { id: 'pt-rolando-arrojo', firstName: 'Rolando', lastName: 'Arrojo', dateOfBirth: '1971-01-02', phone: '+15550100109', coverage: { payerKey: 'cigna', memberId: '5643296', relationship: 'self' }, scenario: 'Active: Cigna' },
  { id: 'pt-rod-beck', firstName: 'Rod', lastName: 'Beck', dateOfBirth: '1972-02-03', phone: '+15550100110', coverage: { payerKey: 'cigna', memberId: 'R5TJR4HR4H', relationship: 'self' }, scenario: 'Active: Cigna' },
  { id: 'pt-david-cone', firstName: 'David', lastName: 'Cone', dateOfBirth: '1973-03-04', phone: '+15550100111', coverage: { payerKey: 'cigna', memberId: '5642296', relationship: 'self' }, scenario: 'Active: Cigna' },
  { id: 'pt-frank-castillo', firstName: 'Frank', lastName: 'Castillo', dateOfBirth: '1975-04-05', phone: '+15550100112', coverage: { payerKey: 'cigna', memberId: 'FTRJRG3254', relationship: 'self' }, scenario: 'Active: Cigna' },
  { id: 'pt-casey-fossum', firstName: 'Casey', lastName: 'Fossum', dateOfBirth: '1976-05-06', phone: '+15550100113', coverage: { payerKey: 'cigna', memberId: '5641296', relationship: 'self' }, scenario: 'Active: Cigna' },
  { id: 'pt-rich-garces', firstName: 'Rich', lastName: 'Garces', dateOfBirth: '1977-06-07', phone: '+15550100114', coverage: { payerKey: 'cigna', memberId: 'DHW5445', relationship: 'self' }, scenario: 'Active: Cigna' },
  { id: 'pt-jane-doe-1975', firstName: 'Jane', lastName: 'Doe', dateOfBirth: '1975-05-05', phone: '+15550100115', coverage: { payerKey: 'humana', memberId: 'HUMANA123', relationship: 'self' }, scenario: 'Active: Humana' },
  { id: 'pt-jane-doe-1955', firstName: 'Jane', lastName: 'Doe', dateOfBirth: '1955-05-05', phone: '+15550100116', coverage: { payerKey: 'medicare', memberId: '1AA2CC3DD45', relationship: 'self' }, scenario: 'Active: Medicare (coinsurance, no copay)' },
  { id: 'pt-jane-doe-1971', firstName: 'Jane', lastName: 'Doe', dateOfBirth: '1971-01-01', phone: '+15550100117', coverage: { payerKey: 'uhc', memberId: 'UHC123456', relationship: 'self' }, scenario: 'Active: UnitedHealthcare' },

  // Not accepted
  { id: 'pt-jane-doe-2002', firstName: 'Jane', lastName: 'Doe', dateOfBirth: '2002-02-02', phone: '+15550100118', coverage: { payerKey: 'kaiser', memberId: 'KAISER123456', relationship: 'self' }, scenario: 'Not accepted: Kaiser (out of network)' },
  { id: 'pt-john-doe-1994', firstName: 'John', lastName: 'Doe', dateOfBirth: '1994-04-04', phone: '+15550100119', coverage: { payerKey: 'ambetter', memberId: 'AMBETTER123', relationship: 'self' }, scenario: 'Not accepted: Ambetter (out of network)' },
  // Same name and birthday as the active UHC Jane Doe above: the member ID tells them apart.
  { id: 'pt-jane-doe-1971-inactive', firstName: 'Jane', lastName: 'Doe', dateOfBirth: '1971-01-01', phone: '+15550100120', coverage: { payerKey: 'uhc', memberId: 'UHCINACTIVE', relationship: 'self' }, scenario: 'Not accepted: coverage inactive' },

  // Payer-side failures (Stedi AAA error mocks)
  { id: 'pt-jane-doe-2001-aaa42', firstName: 'Jane', lastName: 'Doe', dateOfBirth: '2001-01-01', phone: '+15550100121', coverage: { payerKey: 'uhc', memberId: 'UHCAAA42', relationship: 'self' }, scenario: 'Error 42: payer system down' },
  { id: 'pt-jane-doe-1970-aaa43', firstName: 'Jane', lastName: 'Doe', dateOfBirth: '1970-01-01', phone: '+15550100122', coverage: { payerKey: 'uhc', memberId: 'UHCAAA43', relationship: 'self' }, scenario: 'Error 43: provider ID rejected' },
  { id: 'pt-john-doe-1990-aaa72', firstName: 'John', lastName: 'Doe', dateOfBirth: '1990-01-01', phone: '+15550100123', coverage: { payerKey: 'uhc', memberId: 'UHCAAA72', relationship: 'self' }, scenario: 'Error 72: invalid member ID' },
  { id: 'pt-john-doe-1990-aaa73', firstName: 'John', lastName: 'Doe', dateOfBirth: '1990-01-01', phone: '+15550100124', coverage: { payerKey: 'uhc', memberId: 'UHCAAA73', relationship: 'self' }, scenario: 'Error 73: name mismatch' },
  { id: 'pt-jane-doe-1990-aaa75', firstName: 'Jane', lastName: 'Doe', dateOfBirth: '1990-01-01', phone: '+15550100125', coverage: { payerKey: 'uhc', memberId: 'UHCAAA75', relationship: 'self' }, scenario: 'Error 75: member not found' },
  { id: 'pt-john-doe-1970-aaa79', firstName: 'John', lastName: 'Doe', dateOfBirth: '1970-01-01', phone: '+15550100126', coverage: { payerKey: 'uhc', memberId: 'UHCAAA79', relationship: 'self' }, scenario: 'Error 79: invalid participant ID' },

  // Read us their dental card by mistake
  { id: 'pt-falcon-dent', firstName: 'Falcon', lastName: 'Dent', dateOfBirth: '1985-06-07', phone: '+15550100127', coverage: { payerKey: 'ameritas', memberId: '007007007', relationship: 'self' }, scenario: 'Wrong card: dental plan' },
  { id: 'pt-jaguar-dent', firstName: 'Jaguar', lastName: 'Dent', dateOfBirth: '1996-05-05', phone: '+15550100128', coverage: { payerKey: 'cigna', memberId: 'U3141592653', relationship: 'self' }, scenario: 'Wrong card: Cigna dental plan (same payer ID as Cigna medical)' },
];
