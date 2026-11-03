import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Sandbox key: the sandbox's frozen 2024 plan dates are expected, as in production runs against it.
vi.hoisted(() => {
  process.env.STEDI_API_KEY = 'test_unit';
});
vi.mock('../src/stedi/client.js', () => ({ checkEligibility: vi.fn() }));

const { checkEligibility } = await import('../src/stedi/client.js');
const { toolHandlers } = await import('../src/vapi/tools.js');
const { getCall, listCallbacks } = await import('../src/store.js');
const { memberIdsSoundAlike } = await import('../src/normalize.js');

const fixture = (id: string) => JSON.parse(readFileSync(new URL(`./fixtures/${id}.json`, import.meta.url), 'utf8'));
const payerAnswer = (id: string, delayMs = 30) =>
  new Promise((resolve) => setTimeout(() => resolve({ kind: 'response', httpStatus: 200, body: fixture(id), ms: delayMs, attempts: 1 }), delayMs));
const mocked = vi.mocked(checkEligibility);
let n = 0;
const newCall = () => ({ callId: `test-call-${++n}` });

beforeEach(() => mocked.mockReset());

describe('asking the payer while the caller talks', () => {
  it('starts the check when the chart is found and answers from it without asking twice', async () => {
    mocked.mockImplementation(() => payerAnswer('pt-jordan-doe-2001') as never);
    const ctx = newCall();
    await toolHandlers.find_patient!({ full_name: 'Jordan Doe', date_of_birth: '2001-07-14' }, ctx);
    expect(mocked).toHaveBeenCalledTimes(1);

    const out = JSON.parse(await toolHandlers.check_insurance!({ full_name: 'Jordan Doe', date_of_birth: '2001-07-14', insurance_company: 'Aetna', member_id: 'A E T N A 9 W C S U', visit_type: 'medical' }, ctx));
    expect(mocked).toHaveBeenCalledTimes(1);
    expect(out.outcome).toBe('ACCEPTED');
    expect(out.say).toMatch(/15 dollars/);
    const event = getCall(ctx.callId).events.find((e) => e.tool === 'check_insurance')!;
    expect(event.detail).toMatchObject({ prefetched: true });
  });

  it('does not guess between two cards: same name and birthday with different insurers means no early check', async () => {
    const ctx = newCall();
    await toolHandlers.find_patient!({ full_name: 'Jane Doe', date_of_birth: '2001-01-01' }, ctx);
    expect(mocked).not.toHaveBeenCalled();
  });

  it('asks again for real when the caller reads a different card than the one on file', async () => {
    mocked.mockImplementation(() => payerAnswer('pt-jordan-doe-2001') as never);
    const ctx = newCall();
    await toolHandlers.find_patient!({ full_name: 'Jordan Doe', date_of_birth: '2001-07-14' }, ctx);
    await toolHandlers.check_insurance!({ full_name: 'Jordan Doe', date_of_birth: '2001-07-14', insurance_company: 'Aetna', member_id: 'W123456789' }, ctx);
    expect(mocked).toHaveBeenCalledTimes(2);
    expect(mocked.mock.calls[1]![0].subscriber.memberId).toBe('W123456789');
  });

  it('retries fresh when the early check found the payer down', async () => {
    mocked
      .mockImplementationOnce(async () => ({ kind: 'transport_error', error: 'timeout', ms: 12000, attempts: 2 }) as never)
      .mockImplementation(() => payerAnswer('pt-rod-beck') as never);
    const ctx = newCall();
    await toolHandlers.find_patient!({ full_name: 'Rod Beck' }, ctx);
    const out = JSON.parse(await toolHandlers.check_insurance!({ full_name: 'Rod Beck', insurance_company: 'Cigna', member_id: 'R5TJR4HR4H' }, ctx));
    expect(mocked).toHaveBeenCalledTimes(2);
    expect(out.outcome).toBe('ACCEPTED');
  });
});

describe('member IDs misheard on the phone', () => {
  it('treats sound-alike letters and digits as the same card', () => {
    expect(memberIdsSoundAlike('AETNA9WESU', 'AETNA9wcSu')).toBe(true); // C heard as E
    expect(memberIdsSoundAlike('U H E one two three four five six', 'UHC123456')).toBe(true);
    expect(memberIdsSoundAlike('1AA2CC3DD49', '1AA2CC3DD45')).toBe(true); // five heard as nine
    expect(memberIdsSoundAlike('HUNANA123', 'HUMANA123')).toBe(true); // M heard as N
  });

  it('refuses anything that is not a sound-alike slip', () => {
    expect(memberIdsSoundAlike('UHC123457', 'UHC123456')).toBe(false); // 6 and 7 don't sound alike
    expect(memberIdsSoundAlike('UHC12345', 'UHC123456')).toBe(false); // length differs
    expect(memberIdsSoundAlike('ABDEGPT', 'BDEGPTV')).toBe(false); // too many changes
    expect(memberIdsSoundAlike('UHE12', 'UHC12')).toBe(false); // too short to be sure
  });

  it('checks the chart card and notes what was heard', async () => {
    mocked.mockImplementation(() => payerAnswer('pt-jordan-doe-2001') as never);
    const ctx = newCall();
    await toolHandlers.find_patient!({ full_name: 'Jordan Doe', date_of_birth: '2001-07-14' }, ctx);
    const out = JSON.parse(await toolHandlers.check_insurance!({ full_name: 'Jordan Doe', date_of_birth: '2001-07-14', insurance_company: 'Aetna', member_id: 'AETNA9WESU' }, ctx));
    expect(out.outcome).toBe('ACCEPTED');
    expect(mocked).toHaveBeenCalledTimes(1);
    const event = getCall(ctx.callId).events.find((e) => e.tool === 'check_insurance')!;
    expect(event.detail).toMatchObject({ prefetched: true, memberIdHeardAs: 'AETNA9WESU' });
  });
});

describe('callbacks', () => {
  it('puts urgent eye symptoms at the top of the queue and promises a same-day call', async () => {
    await toolHandlers.request_callback!({ caller_name: 'Pat', phone_number: '+15550000001', reason: 'Billing question' }, newCall());
    const out = JSON.parse(await toolHandlers.request_callback!({ caller_name: 'Sam', phone_number: '+15550000002', reason: 'Painful red eye, contact lens wearer', urgent: true }, newCall()));
    await toolHandlers.request_callback!({ caller_name: 'Lee', phone_number: '+15550000003', reason: 'Wants to book' }, newCall());
    expect(out.say).toMatch(/today/);
    expect(listCallbacks().map((c) => c.callerName)).toEqual(['Sam', 'Lee', 'Pat']);
  });
});
