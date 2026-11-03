import type { Outcome } from '../src/eligibility/script.js';

/**
 * Golden tests on real 271 responses captured from the Stedi sandbox (`yarn eval --save`).
 * Each row pins what the caller hears. Every amount was checked by hand against the
 * benefit line it came from (noted on the right), so a change to any rule that alters a
 * spoken number fails here first.
 */
export const GOLDEN: [patientId: string, outcome: Outcome, mustSay: RegExp, why: string][] = [
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
