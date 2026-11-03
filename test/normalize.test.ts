import { describe, expect, it } from 'vitest';
import { memberIdFromSpeech, memberIdsMatch, parseDateOfBirth, spokenDollars, splitFullName } from '../src/normalize.js';
import { lookupPatient, pickByCoverage } from '../src/patients.js';
import { resolvePayer } from '../src/payers.js';

describe('member IDs from speech', () => {
  it.each([
    ['U H C inactive', 'UHCINACTIVE'],
    ['one A A two C C three D D four five', '1AA2CC3DD45'],
    ['A-E-T-N-A 9 w c s u', 'AETNA9WCSU'],
    ['U H C triple A forty two', 'UHCAAA42'],
    ['D H W double five four five', 'DHW5545'],
    ['Oscar one two three four five six', 'OSCAR123456'],
    ['R as in Robert 5 T J R 4 H R 4 H', 'R5TJR4HR4H'],
    ['romeo five tango juliet', 'R5TJ'],
  ])('%s -> %s', (spoken, expected) => {
    expect(memberIdFromSpeech(spoken)).toBe(expected);
  });

  it('matches mixed-case sandbox IDs regardless of how they were spoken', () => {
    expect(memberIdsMatch('aetna9wcsu', 'AETNA9wcSu')).toBe(true);
    expect(memberIdsMatch('C I G N A J T U X N M', 'CIGNAJTUxNm')).toBe(true);
    expect(memberIdsMatch('UHC12345', 'UHC123456')).toBe(false);
  });
});

describe('dates of birth', () => {
  it.each([
    ['2001-07-14', '2001-07-14'],
    ['07/14/2001', '2001-07-14'],
    ['July 14th, 2001', '2001-07-14'],
    ['14 July 2001', '2001-07-14'],
    ['20010714', '2001-07-14'],
    ['February 30 2001', null],
    ['next tuesday', null],
  ])('%s -> %s', (input, expected) => {
    expect(parseDateOfBirth(input)).toBe(expected);
  });
});

describe('payer names as callers say them', () => {
  it.each([
    ['united', 'uhc'],
    ['I have UnitedHealthcare', 'uhc'],
    ['Signa', 'cigna'],
    ['it\'s Medicare, the red white and blue card', 'medicare'],
    ['Kaiser Permanente', 'kaiser'],
    ['blue cross blue shield of texas', 'bcbs-tx'],
  ])('%s -> %s', (spoken, key) => {
    const r = resolvePayer(spoken);
    expect(r.status).toBe('resolved');
    expect(r.status === 'resolved' && r.payer.key).toBe(key);
  });

  it('asks which plan when "Blue Cross" is ambiguous', () => {
    expect(resolvePayer('Blue Cross').status).toBe('ambiguous');
  });

  it('uses the chart to break the tie', () => {
    const r = resolvePayer('Blue Cross', 'bcbs-tx');
    expect(r.status === 'resolved' && r.payer.key).toBe('bcbs-tx');
  });

  it('does not pretend to know a payer it has never seen', () => {
    expect(resolvePayer('Acme Health Mutual').status).toBe('unknown');
  });
});

describe('finding the patient', () => {
  it('finds a unique name immediately', () => {
    const r = lookupPatient('Rod Beck');
    expect(r.status).toBe('found');
  });

  it('tolerates speech-to-text surname errors', () => {
    const r = lookupPatient('Rolando Arroyo');
    expect(r.status === 'found' && r.patients[0]!.lastName).toBe('Arrojo');
    expect(r.status === 'found' && r.exactName).toBe(false);
  });

  it('asks for a birthday when the name is shared', () => {
    expect(lookupPatient('Jane Doe').status).toBe('need_date_of_birth');
  });

  it('uses the insurance card when name and birthday are both shared', () => {
    const r = lookupPatient('Jane Doe', '1971-01-01');
    expect(r.status === 'found' && r.patients.length).toBe(2);
    if (r.status !== 'found') return;
    expect(pickByCoverage(r.patients, 'uhc', 'U H C inactive')?.id).toBe('pt-jane-doe-1971-inactive');
    expect(pickByCoverage(r.patients, 'uhc', 'UHC123456')?.id).toBe('pt-jane-doe-1971');
  });

  it('handles "Last, First" and nicknames', () => {
    expect(splitFullName('Doe, Jordan')).toEqual({ first: 'jordan', last: 'doe' });
    expect(lookupPatient('Richard Garces').status).toBe('found');
  });
});

describe('speech formatting', () => {
  it('reads money the way a person says it', () => {
    expect(spokenDollars(35)).toBe('35 dollars');
    expect(spokenDollars(1)).toBe('1 dollar');
    expect(spokenDollars(12.5)).toBe('12 dollars and 50 cents');
  });
});
