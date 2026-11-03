import { PATIENTS, type Patient } from './data/patients.js';
import { firstNamesMatch, lastNamesClose, memberIdsMatch, normalizeText, splitFullName } from './normalize.js';

export type PatientLookup =
  | { status: 'found'; patients: Patient[]; exactName: boolean }
  | { status: 'need_date_of_birth'; count: number }
  | { status: 'dob_mismatch' }
  | { status: 'not_found' };

/**
 * We trust whoever the caller says they are (per the brief), but names aren't unique:
 * the sandbox roster alone has a dozen Jane and John Does. So we narrow progressively,
 * name -> date of birth -> the insurance card itself, and only ask for what's needed.
 */
export function lookupPatient(fullName: string, dateOfBirth?: string | null): PatientLookup {
  const { first, last } = splitFullName(fullName);
  if (!first || !last) return { status: 'not_found' };

  const exact = PATIENTS.filter(
    (p) => firstNamesMatch(p.firstName, first) && normalizeText(p.lastName) === last,
  );
  const candidates = exact.length
    ? exact
    : PATIENTS.filter((p) => firstNamesMatch(p.firstName, first) && lastNamesClose(p.lastName, last));
  if (!candidates.length) return { status: 'not_found' };

  if (dateOfBirth) {
    const byDob = candidates.filter((p) => p.dateOfBirth === dateOfBirth);
    if (!byDob.length) return { status: 'dob_mismatch' };
    return { status: 'found', patients: byDob, exactName: exact.length > 0 };
  }
  if (candidates.length > 1) return { status: 'need_date_of_birth', count: candidates.length };
  return { status: 'found', patients: candidates, exactName: exact.length > 0 };
}

/** Among same-name patients, pick the one whose card matches what the caller just read us. */
export function pickByCoverage(patients: Patient[], payerKey: string, spokenMemberId: string): Patient | undefined {
  return patients.find(
    (p) => p.coverage.payerKey === payerKey && memberIdsMatch(spokenMemberId, p.coverage.memberId),
  );
}

export function patientById(id: string): Patient | undefined {
  return PATIENTS.find((p) => p.id === id);
}
