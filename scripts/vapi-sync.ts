/**
 * Creates or updates the Vapi assistant from src/vapi/assistant.ts and makes sure a phone
 * number points at it. Idempotent: run it after every prompt or tool change.
 *
 *   yarn vapi:sync                      # uses PUBLIC_BASE_URL / RENDER_EXTERNAL_URL
 *   yarn vapi:sync --url https://x.y    # point the assistant at another server
 *   yarn vapi:sync --area-code 415      # area code for a new free number
 */
import { env, publicBaseUrl } from '../src/config.js';
import { buildAssistant } from '../src/vapi/assistant.js';

const VAPI = 'https://api.vapi.ai';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function vapi<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${VAPI}${path}`, {
    method,
    headers: { Authorization: `Bearer ${env.VAPI_API_KEY}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${text}`);
  return (text ? JSON.parse(text) : {}) as T;
}

interface Assistant { id: string; name: string }
interface PhoneNumber { id: string; number?: string; sipUri?: string; assistantId?: string; status?: string; provider: string }

async function main() {
  if (!env.VAPI_API_KEY) throw new Error('VAPI_API_KEY is missing from .env');
  const serverUrl = (arg('url') ?? publicBaseUrl())?.replace(/\/$/, '');
  if (!serverUrl) throw new Error('Set PUBLIC_BASE_URL in .env (or pass --url) so Vapi can reach this server.');

  const config = buildAssistant(serverUrl);
  const existing = (await vapi<Assistant[]>('GET', '/assistant?limit=100')).find((a) => a.name === config.name);
  const assistant = existing
    ? await vapi<Assistant>('PATCH', `/assistant/${existing.id}`, config)
    : await vapi<Assistant>('POST', '/assistant', config);
  console.log(`${existing ? 'Updated' : 'Created'} assistant "${assistant.name}" (${assistant.id}) -> ${config.server.url}`);

  const numbers = await vapi<PhoneNumber[]>('GET', '/phone-number?limit=100');
  let phone = numbers.find((n) => n.assistantId === assistant.id) ?? numbers.find((n) => n.provider === 'vapi' && !n.assistantId);
  if (phone && phone.assistantId !== assistant.id) {
    phone = await vapi<PhoneNumber>('PATCH', `/phone-number/${phone.id}`, { assistantId: assistant.id });
  }
  if (!phone) {
    phone = await vapi<PhoneNumber>('POST', '/phone-number', {
      provider: 'vapi',
      name: 'Insurance line',
      assistantId: assistant.id,
      ...(arg('area-code') ? { numberDesiredAreaCode: arg('area-code') } : {}),
    });
    console.log('Created a free Vapi number. Activation can take a few minutes.');
  }
  console.log(`Phone number: ${phone.number ?? '(provisioning…)'}  status=${phone.status ?? 'unknown'}`);
  console.log(`\nVAPI_ASSISTANT_ID=${assistant.id}`);
  if (phone.number) console.log(`CLINIC_PHONE_NUMBER=${phone.number}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
