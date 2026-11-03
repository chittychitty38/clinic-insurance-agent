/**
 * In-memory call log for the demo dashboard. Each verification is recorded with the exact
 * payer response that produced the answer, so any sentence the agent spoke can be audited.
 * Production would put this in Postgres with PHI-grade access controls and retention.
 */

export interface ToolEvent {
  at: string;
  tool: string;
  args: Record<string, unknown>;
  outcome?: string;
  say?: string;
  ms: number;
  detail?: unknown;
}

export interface CallbackRequest {
  id: string;
  at: string;
  callId: string;
  callerName: string;
  phone: string | null;
  reason: string;
  /** Eye symptoms that should be seen today: staff call these back first. */
  urgent: boolean;
  status: 'open' | 'done';
}

export interface CallRecord {
  id: string;
  startedAt: string;
  source: 'phone' | 'web' | 'chat' | 'dashboard';
  callerNumber?: string;
  events: ToolEvent[];
  endedAt?: string;
  endedReason?: string;
  summary?: string;
  transcript?: string;
  recordingUrl?: string;
  durationSeconds?: number;
  cost?: number;
  /** Vapi's post-call grade against the rubric in assistant.ts, and the fields it extracted. */
  qaPassed?: boolean;
  qa?: Record<string, unknown>;
}

const MAX_CALLS = 200;
const calls = new Map<string, CallRecord>();
const callbacks: CallbackRequest[] = [];

export function getCall(id: string, init?: Partial<CallRecord>): CallRecord {
  let call = calls.get(id);
  if (!call) {
    call = { id, startedAt: new Date().toISOString(), source: 'phone', events: [], ...init };
    calls.set(id, call);
    if (calls.size > MAX_CALLS) calls.delete(calls.keys().next().value!);
  } else if (init) {
    Object.assign(call, Object.fromEntries(Object.entries(init).filter(([, v]) => v !== undefined)));
  }
  return call;
}

/** Drop a call record entirely (the project site's live checks shouldn't crowd out real calls). */
export function forgetCall(id: string): void {
  calls.delete(id);
}

export function recordEvent(callId: string, event: Omit<ToolEvent, 'at'>): void {
  getCall(callId).events.push({ at: new Date().toISOString(), ...event });
}

/** How many times the payer already rejected the details given on this call. */
export function verificationFailures(callId: string): number {
  return getCall(callId).events.filter((e) => e.tool === 'check_insurance' && e.outcome === 'PLEASE_VERIFY_DETAILS').length;
}

export function addCallback(req: Omit<CallbackRequest, 'id' | 'at' | 'status'>): CallbackRequest {
  const cb: CallbackRequest = { id: `cb_${Date.now().toString(36)}`, at: new Date().toISOString(), status: 'open', ...req };
  callbacks.unshift(cb);
  // Urgent requests stay at the top of the queue; the sort is stable, so newest first within each.
  callbacks.sort((a, b) => Number(b.urgent) - Number(a.urgent));
  return cb;
}

export function listCalls(): CallRecord[] {
  return [...calls.values()].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

export function listCallbacks(): CallbackRequest[] {
  return callbacks;
}

export function resolveCallback(id: string): void {
  const cb = callbacks.find((c) => c.id === id);
  if (cb) cb.status = 'done';
}
