import express from 'express';
import { env, isStediSandbox, publicBaseUrl } from './config.js';
import { renderDashboard } from './dashboard.js';
import { demoRouter } from './demo.js';
import { PATIENTS } from './data/patients.js';
import { verifyInsurance } from './eligibility/service.js';
import { payerByKey } from './payers.js';
import { getCall, listCallbacks, listCalls, recordEvent, resolveCallback } from './store.js';
import { WEBHOOK_PATH } from './vapi/assistant.js';
import { vapiWebhook } from './vapi/webhook.js';

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '2mb' }));

// Public and read-only: the project site polls it to show (and wake) the line before a call.
app.get('/health', (_req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.json({ ok: true, stedi: env.STEDI_API_KEY ? (isStediSandbox ? 'sandbox' : 'production') : 'missing', webhookSecret: !!env.VAPI_WEBHOOK_SECRET, commit: process.env.RENDER_GIT_COMMIT?.slice(0, 7) ?? null });
});

app.use(WEBHOOK_PATH, vapiWebhook);

// Public, sandbox-only "run it live" for the project site (see demo.ts). Mounted before the token-protected staff routes.
app.use('/api/demo', demoRouter);

// Dashboard + demo API (staff-facing; token-protected when DASHBOARD_TOKEN is set)
const staff = express.Router();
staff.use((req, res, next) => {
  if (!env.DASHBOARD_TOKEN) return next();
  const token = req.query.token ?? req.header('x-dashboard-token');
  if (token === env.DASHBOARD_TOKEN) return next();
  res.status(401).send('Add ?token=… to the URL.');
});

staff.get('/', (req, res) => {
  res.type('html').send(renderDashboard({ token: typeof req.query.token === 'string' ? req.query.token : undefined }));
});

staff.get('/api/state', (_req, res) => {
  res.json({ calls: listCalls(), callbacks: listCallbacks() });
});

// Run any preset patient through the exact same pipeline the phone agent uses.
staff.post('/api/check/:patientId', async (req, res) => {
  const patient = PATIENTS.find((p) => p.id === req.params.patientId);
  if (!patient) {
    res.status(404).json({ error: 'unknown patient' });
    return;
  }
  const callId = `dashboard-${Date.now().toString(36)}`;
  getCall(callId, { source: 'dashboard' });
  const args = {
    full_name: `${patient.firstName} ${patient.lastName}`,
    date_of_birth: patient.dateOfBirth,
    insurance_company: payerByKey(patient.coverage.payerKey)?.displayName ?? patient.coverage.payerKey,
    member_id: patient.coverage.memberId,
    visit_type: req.body?.visit_type === 'routine' ? ('routine' as const) : ('medical' as const),
  };
  const started = Date.now();
  const { answer, audit } = await verifyInsurance(args, callId);
  recordEvent(callId, { tool: 'check_insurance', args, outcome: answer.outcome, say: answer.say, ms: Date.now() - started, detail: audit });
  res.json({ answer, audit: { ...audit, rawResponse: undefined } });
});

staff.post('/api/callbacks/:id/done', (req, res) => {
  resolveCallback(req.params.id);
  res.json({ ok: true });
});

app.use('/', staff);

app.listen(env.PORT, () => {
  console.log(`Insurance agent listening on :${env.PORT}`);
  console.log(`  Stedi key: ${env.STEDI_API_KEY ? 'set' : 'MISSING'} | Vapi key: ${env.VAPI_API_KEY ? 'set' : 'MISSING'} | public URL: ${publicBaseUrl() ?? 'not set'}`);
});
