import { env } from '../config.js';
import type { EligibilityRequest, EligibilityResponse } from './types.js';

export type StediCallResult =
  | { kind: 'response'; httpStatus: number; body: EligibilityResponse; ms: number; attempts: number }
  | { kind: 'transport_error'; error: string; httpStatus?: number; ms: number; attempts: number };

const RETRYABLE_HTTP = new Set([429, 500, 502, 503, 504]);

/**
 * One real-time 270/271 check. Payer AAA errors can arrive with non-200 statuses
 * (AAA 42 comes back as a 429), so anything with an `errors` array or `plans`
 * is treated as a payer answer and interpreted downstream, whatever the status code.
 *
 * We retry once, only for "try again" failures (AAA 42, 5xx, timeouts), and keep the
 * total under Vapi's tool timeout so the caller never sits in silence.
 */
export async function checkEligibility(request: EligibilityRequest, opts: { retries?: number } = {}): Promise<StediCallResult> {
  if (!env.STEDI_API_KEY) {
    return { kind: 'transport_error', error: 'STEDI_API_KEY is not configured', ms: 0, attempts: 0 };
  }
  const retries = opts.retries ?? 1;
  const started = Date.now();
  let last: StediCallResult | undefined;

  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    last = await callOnce(request, started, attempt);
    if (!shouldRetry(last) || attempt > retries) break;
    await new Promise((r) => setTimeout(r, 1200));
  }
  return last!;
}

async function callOnce(request: EligibilityRequest, started: number, attempt: number): Promise<StediCallResult> {
  try {
    const res = await fetch(`${env.STEDI_BASE_URL}/eligibility-check`, {
      method: 'POST',
      headers: {
        Authorization: `Key ${env.STEDI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(env.STEDI_TIMEOUT_MS),
    });
    const text = await res.text();
    let body: EligibilityResponse | undefined;
    try {
      body = JSON.parse(text) as EligibilityResponse;
    } catch {
      /* non-JSON body: handled below */
    }
    const ms = Date.now() - started;
    if (body && (body.plans || body.errors?.length)) {
      return { kind: 'response', httpStatus: res.status, body, ms, attempts: attempt };
    }
    return {
      kind: 'transport_error',
      httpStatus: res.status,
      error: body?.message ?? text.slice(0, 300) ?? `HTTP ${res.status}`,
      ms,
      attempts: attempt,
    };
  } catch (err) {
    const error = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    return { kind: 'transport_error', error, ms: Date.now() - started, attempts: attempt };
  }
}

function shouldRetry(result: StediCallResult): boolean {
  if (result.kind === 'transport_error') {
    return result.httpStatus === undefined || RETRYABLE_HTTP.has(result.httpStatus);
  }
  // AAA 42 = "Unable to respond at current time": the only payer rejection worth an immediate retry.
  return result.body.errors?.some((e) => e.code === '42') ?? false;
}
