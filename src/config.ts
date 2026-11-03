import { z } from 'zod';

const EnvSchema = z.object({
  PORT: z.coerce.number().default(3000),
  // Public URL Vapi uses to reach this server. Render sets RENDER_EXTERNAL_URL automatically.
  PUBLIC_BASE_URL: z.string().url().optional(),
  RENDER_EXTERNAL_URL: z.string().url().optional(),

  STEDI_API_KEY: z.string().min(1).optional(),
  STEDI_BASE_URL: z.string().url().default('https://healthcare.us.stedi.com/2026-06-01'),
  // Any NPI that passes the check-digit test works in the Stedi sandbox.
  STEDI_PROVIDER_NPI: z.string().regex(/^\d{10}$/).default('1999999984'),
  STEDI_TIMEOUT_MS: z.coerce.number().default(12_000),

  VAPI_API_KEY: z.string().min(1).optional(),
  // Shared secret Vapi sends on every webhook so random callers can't hit our tools.
  VAPI_WEBHOOK_SECRET: z.string().min(16).optional(),
  VAPI_MODEL_PROVIDER: z.string().default('anthropic'),
  VAPI_MODEL: z.string().default('claude-haiku-5-5'),
  VAPI_VOICE_PROVIDER: z.string().default('vapi'),
  VAPI_VOICE_ID: z.string().default('Savannah'),

  // Optional: real front-desk line for live transfers. Without it the agent books callbacks instead.
  FRONT_DESK_NUMBER: z.string().regex(/^\+\d{10,15}$/).optional(),
  // The Vapi number patients dial; shown on the dashboard. `yarn vapi:sync` prints it.
  CLINIC_PHONE_NUMBER: z.string().optional(),
  // Optional: protects the dashboard (it shows call details).
  DASHBOARD_TOKEN: z.string().min(8).optional(),
});

// `KEY=` in a .env file or an empty dashboard field means "not set", not "set to empty".
const present = Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== undefined && v.trim() !== ''));
const parsed = EnvSchema.safeParse(present);
if (!parsed.success) {
  console.error('Invalid environment configuration:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;

export function publicBaseUrl(): string | undefined {
  return (env.PUBLIC_BASE_URL ?? env.RENDER_EXTERNAL_URL)?.replace(/\/$/, '');
}
