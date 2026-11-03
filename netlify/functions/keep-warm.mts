/**
 * Render's free tier puts the agent server to sleep after 15 idle minutes, and waking it takes
 * up to a minute: long enough for the first tool call on a phone call to time out. This pings
 * /health every 10 minutes so the line is always warm. One always-on service is ~744 h a month,
 * inside Render's 750 free hours.
 */
const SERVER = 'https://clinic-insurance-agent.onrender.com/health';

export default async () => {
  const started = Date.now();
  try {
    const res = await fetch(SERVER, { signal: AbortSignal.timeout(60_000) });
    console.log(JSON.stringify({ evt: 'keep-warm', status: res.status, ms: Date.now() - started }));
  } catch (err) {
    console.error(JSON.stringify({ evt: 'keep-warm', error: String(err), ms: Date.now() - started }));
  }
  return new Response(null, { status: 204 });
};

export const config = { schedule: '*/10 * * * *' };
