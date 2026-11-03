import { timingSafeEqual } from 'node:crypto';
import { Router, type Request } from 'express';
import { env } from '../config.js';
import { getCall } from '../store.js';
import { WEBHOOK_SECRET_HEADER } from './assistant.js';
import { runTool } from './tools.js';

/**
 * Vapi posts every server message here: tool calls during the conversation, status
 * updates, and an end-of-call report with transcript and summary.
 * Docs: https://docs.vapi.ai/server-url/events
 */

interface ToolCall {
  id: string;
  name?: string;
  function?: { name: string; arguments?: unknown };
  arguments?: unknown;
}

interface VapiMessage {
  type: string;
  call?: { id?: string; type?: string; customer?: { number?: string } };
  chat?: { id?: string };
  session?: { id?: string };
  toolCallList?: ToolCall[];
  toolWithToolCallList?: { toolCall: ToolCall }[];
  status?: string;
  endedReason?: string;
  summary?: string;
  transcript?: string;
  recordingUrl?: string;
  durationSeconds?: number;
  cost?: number;
  analysis?: { summary?: string };
  artifact?: { transcript?: string; recordingUrl?: string; recording?: { mono?: { combinedUrl?: string } } };
}

export const vapiWebhook = Router();

vapiWebhook.post('/', async (req, res) => {
  if (!authorized(req)) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  const message = (req.body?.message ?? {}) as VapiMessage;
  // Text chats (used by the conversation eval) carry a chat/session instead of a call.
  const callId = message.call?.id ?? message.chat?.id ?? message.session?.id ?? 'unknown-call';
  const callerNumber = message.call?.customer?.number;
  const source = message.call ? (message.call.type === 'webCall' ? 'web' : 'phone') : 'chat';

  switch (message.type) {
    case 'tool-calls': {
      const calls = message.toolCallList ?? message.toolWithToolCallList?.map((t) => t.toolCall) ?? [];
      getCall(callId, { callerNumber, source });
      const results = await Promise.all(
        calls.map(async (tc) => {
          const name = tc.function?.name ?? tc.name ?? '';
          const outcome = await runTool(name, parseArgs(tc.function?.arguments ?? tc.arguments), { callId, callerNumber });
          return { name, toolCallId: tc.id, ...outcome };
        }),
      );
      res.json({ results });
      return;
    }
    case 'status-update': {
      getCall(callId, { callerNumber, source });
      res.json({});
      return;
    }
    case 'end-of-call-report': {
      const call = getCall(callId, { callerNumber, source });
      call.endedAt = new Date().toISOString();
      call.endedReason = message.endedReason;
      call.summary = message.analysis?.summary ?? message.summary;
      call.transcript = message.artifact?.transcript ?? message.transcript;
      call.recordingUrl = message.artifact?.recordingUrl ?? message.recordingUrl ?? message.artifact?.recording?.mono?.combinedUrl;
      call.durationSeconds = message.durationSeconds;
      call.cost = message.cost;
      res.json({});
      return;
    }
    default:
      res.json({});
  }
});

function authorized(req: Request): boolean {
  if (!env.VAPI_WEBHOOK_SECRET) return true;
  const given = req.header(WEBHOOK_SECRET_HEADER) ?? '';
  const a = Buffer.from(given);
  const b = Buffer.from(env.VAPI_WEBHOOK_SECRET);
  return a.length === b.length && timingSafeEqual(a, b);
}

function parseArgs(args: unknown): unknown {
  if (typeof args === 'string') {
    try {
      return JSON.parse(args);
    } catch {
      return {};
    }
  }
  return args ?? {};
}
