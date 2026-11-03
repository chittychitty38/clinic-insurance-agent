import { Router } from 'express';
import { isStediSandbox } from './config.js';
import { PATIENTS } from './data/patients.js';
import { verifyInsurance } from './eligibility/service.js';
import { payerByKey } from './payers.js';
import { forgetCall, getCall } from './store.js';

/**
 * Public "run it live" button on the project site: one preset sandbox patient through the exact
 * pipeline the phone agent uses, so a visitor can watch a real Stedi check reproduce the published
 * answer. Nothing a visitor types reaches Stedi (the patient comes from the chart), it only runs
 * against the sandbox, only for the project site's origin, and it's rate-limited.
 */

const SITE = /^https:\/\/([a-z0-9]+--)?clinic-insurance-agent\.netlify\.app$|^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
export const allowedOrigin = (origin: string | undefined): boolean => !!origin && SITE.test(origin);

const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 60;
const recent: number[] = [];

/** Sliding-window limit across all visitors: enough for "run all 27" twice a minute, not for abuse. */
export function takeDemoSlot(now = Date.now(), log = recent): boolean {
  while (log.length && now - log[0]! > WINDOW_MS) log.shift();
  if (log.length >= MAX_PER_WINDOW) return false;
  log.push(now);
  return true;
}

export const demoRouter = Router();

demoRouter.use((req, res, next) => {
  const origin = req.header('origin');
  if (allowedOrigin(origin)) {
    res.set('Access-Control-Allow-Origin', origin!);
    res.set('Vary', 'Origin');
  }
  if (req.method === 'OPTIONS') {
    res.set('Access-Control-Allow-Methods', 'POST');
    res.status(204).end();
    return;
  }
  next();
});

demoRouter.post('/check/:patientId', async (req, res) => {
  if (!isStediSandbox) {
    res.status(404).json({ error: 'The live demo only runs against the Stedi sandbox.' });
    return;
  }
  if (!allowedOrigin(req.header('origin'))) {
    res.status(403).json({ error: 'The live demo runs from the project site.' });
    return;
  }
  const patient = PATIENTS.find((p) => p.id === req.params.patientId);
  if (!patient) {
    res.status(404).json({ error: 'Unknown sandbox patient.' });
    return;
  }
  if (!takeDemoSlot()) {
    res.status(429).json({ error: 'Lots of live checks right now. Try again in a minute.' });
    return;
  }

  // A throwaway call record: verifyInsurance needs one, the staff dashboard doesn't.
  const callId = `site-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  getCall(callId, { source: 'dashboard' });
  const started = Date.now();
  const { answer, audit } = await verifyInsurance(
    {
      full_name: `${patient.firstName} ${patient.lastName}`,
      date_of_birth: patient.dateOfBirth,
      insurance_company: payerByKey(patient.coverage.payerKey)?.displayName ?? patient.coverage.payerKey,
      member_id: patient.coverage.memberId,
      visit_type: 'medical',
    },
    callId,
  ).finally(() => forgetCall(callId));
  res.json({
    outcome: answer.outcome,
    say: answer.say,
    stediCheckId: audit.stediCheckId ?? null,
    stediMs: audit.ms ?? null,
    attempts: audit.attempts ?? null,
    totalMs: Date.now() - started,
    at: new Date().toISOString(),
  });
});
