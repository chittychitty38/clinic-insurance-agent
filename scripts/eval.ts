/**
 * Accuracy eval: every preset patient through the real pipeline (live Stedi sandbox),
 * checked against the outcome a careful front-desk person would give. Exit code 1 on any miss.
 *
 *   yarn eval            # medical visit
 *   yarn eval --routine  # routine eye exam (adds the refraction heads-up)
 *   yarn eval --save     # also write each raw 271 to test/fixtures/ for offline tests
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { PATIENTS, type Patient } from '../src/data/patients.js';
import { verifyInsurance, type ToolOutcome } from '../src/eligibility/service.js';
import { payerByKey } from '../src/payers.js';

const EXPECTED: Record<string, ToolOutcome[]> = {
  'Active': ['ACCEPTED'],
  'Not accepted: Kaiser': ['NOT_IN_NETWORK'],
  'Not accepted: Ambetter': ['NOT_IN_NETWORK'],
  'Not accepted: coverage inactive': ['COVERAGE_INACTIVE'],
  'Not accepted: plan network': ['NOT_IN_NETWORK'],
  'Error 42': ['PAYER_UNAVAILABLE'],
  'Error 43': ['CLINIC_SETUP_ISSUE'],
  'Error 72': ['PLEASE_VERIFY_DETAILS'],
  'Error 73': ['PLEASE_VERIFY_DETAILS'],
  'Error 75': ['PLEASE_VERIFY_DETAILS'],
  'Error 79': ['CLINIC_SETUP_ISSUE'],
  'Wrong card': ['DENTAL_PLAN'],
};

function expectedFor(p: Patient): ToolOutcome[] {
  const key = Object.keys(EXPECTED).find((k) => p.scenario.startsWith(k));
  return key ? EXPECTED[key]! : [];
}

const routine = process.argv.includes('--routine');
const save = process.argv.includes('--save');
if (save) mkdirSync('test/fixtures', { recursive: true });

let failures = 0;
const rows: string[] = [];
for (const p of PATIENTS) {
  const { answer, audit } = await verifyInsurance(
    {
      full_name: `${p.firstName} ${p.lastName}`,
      date_of_birth: p.dateOfBirth,
      insurance_company: payerByKey(p.coverage.payerKey)!.displayName,
      member_id: p.coverage.memberId,
      visit_type: routine ? 'routine' : 'medical',
    },
    `eval-${p.id}`,
  );
  const expected = expectedFor(p);
  // "Accepted" with a copay we refuse to guess is still a correct, safe answer.
  const ok = expected.includes(answer.outcome) || (expected.includes('ACCEPTED') && answer.outcome === 'ACCEPTED_COPAY_UNCONFIRMED');
  if (!ok) failures++;
  if (save && audit.rawResponse) writeFileSync(`test/fixtures/${p.id}.json`, JSON.stringify(audit.rawResponse, null, 2));
  rows.push(
    `${ok ? 'PASS' : 'FAIL'}  ${p.id.padEnd(28)} ${answer.outcome.padEnd(26)} ${String(audit.ms ?? '-').padStart(5)}ms\n      ${p.scenario}\n      "${answer.say}"`,
  );
}

console.log(rows.join('\n\n'));
console.log(`\n${PATIENTS.length - failures}/${PATIENTS.length} scenarios correct${failures ? `, ${failures} FAILED` : ''}.`);
process.exit(failures ? 1 : 0);
