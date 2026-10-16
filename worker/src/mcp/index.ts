// Working Book's MCP server: Claude (claude.ai, the mobile app, Claude Code)
// reads and fills the shared Suivi workbooks, with GridCraft's engine running
// here in wasm. Its own Worker (wrangler.mcp.toml), so the API's Worker never
// loads the engine.
//
//   POST   /mcp        MCP, Streamable HTTP with JSON replies (no server stream)
//   DELETE /mcp        ends the session
//   /authorize         the passphrase page (authorize.ts)
//   /token, /register  OAuth, served by @cloudflare/workers-oauth-provider
//
// Each MCP session (Mcp-Session-Id) is a Durable Object holding the open
// shift's workbook (session.ts).
//
// The Suivi assistant (assist.ts) lives here too, for the engine: the API's
// Worker reaches it through the `Assist` entrypoint, over a service binding
// that no URL leads to.

import { OAuthProvider } from '@cloudflare/workers-oauth-provider';
import { WorkerEntrypoint } from 'cloudflare:workers';
import type { AssistReply, AssistRequest } from '../assistTypes';
import { authorize, USER_ID, type AuthEnv } from './authorize';
import { McpSession, type McpEnv } from './session';

export { McpSession };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const POSTE_RE = /^[ABCD]$/;
const MODES = new Set(['saisie', 'controle', 'bilan']);
// All shifts together: the routes have no auth yet, and a runaway shouldn't
// spend the month's credits in a day. Each shift also has its own hourly cap.
const ASSIST_PER_DAY = 300;

export class Assist extends WorkerEntrypoint<Env> {
  /** One question to the assistant, answered by the shift's own session. */
  async run(req: AssistRequest): Promise<AssistReply> {
    if (!req || !DATE_RE.test(String(req.date)) || !POSTE_RE.test(String(req.poste)) || !MODES.has(req.mode)) return { ok: false, error: 'Demande invalide.' };
    if (req.mode === 'saisie' && !req.text?.trim()) return { ok: false, error: 'Rien à saisir : écris ou dicte ce qu’il faut remplir.' };
    const budget = this.env.SESSIONS.get(this.env.SESSIONS.idFromName('assist:budget'));
    if (!(await budget.spend(ASSIST_PER_DAY))) return { ok: false, error: `L’assistant a répondu ${ASSIST_PER_DAY} fois aujourd’hui, sa limite : il revient demain.` };
    const session = this.env.SESSIONS.get(this.env.SESSIONS.idFromName(`assist:${req.date}:${req.poste}`));
    return (await session.assist({ date: req.date, poste: req.poste, mode: req.mode, text: req.text })) as AssistReply;
  }
}

interface Env extends McpEnv, AuthEnv {
  OAUTH_KV: KVNamespace;
  /** This server's MCP endpoint, https://…/mcp: the OAuth resource. */
  MCP_RESOURCE: string;
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });

const rpcError = (status: number, code: number, message: string) => json({ jsonrpc: '2.0', id: null, error: { code, message } }, status);

async function mcp(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const userId = ((ctx as unknown as { props?: { userId?: string } }).props?.userId ?? USER_ID).toString();
  const sid = request.headers.get('Mcp-Session-Id');
  const session = (id: string) => env.SESSIONS.get(env.SESSIONS.idFromName(id));

  if (request.method === 'DELETE') {
    if (sid) await session(sid).close();
    return new Response(null, { status: 204 });
  }
  // No server-initiated stream: every reply is the POST's own response.
  if (request.method !== 'POST') return new Response(null, { status: 405, headers: { Allow: 'POST, DELETE' } });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return rpcError(400, -32700, 'parse error');
  }
  const messages = (Array.isArray(body) ? body : [body]) as { id?: unknown; method?: unknown }[];
  if (!messages.length) return rpcError(400, -32600, 'empty batch');
  const create = messages.some((m) => m && m.method === 'initialize');
  const id = create ? crypto.randomUUID() : sid;
  if (!id) return rpcError(400, -32000, 'missing Mcp-Session-Id: send initialize first');

  const replies = (await session(id).handle(messages as never, { create, userId })) as unknown[] | null;
  // Unknown or ended session: the client starts a new one.
  if (replies === null) return rpcError(404, -32001, 'session not found');
  const headers = { 'Mcp-Session-Id': id };
  if (!replies.length) return new Response(null, { status: 202, headers });
  return json(Array.isArray(body) ? replies : replies[0], 200, headers);
}

let provider: OAuthProvider<Env> | null = null;

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    provider ??= new OAuthProvider<Env>({
      apiRoute: '/mcp',
      apiHandler: { fetch: mcp as never },
      defaultHandler: {
        async fetch(request: Request, env: Env) {
          const path = new URL(request.url).pathname;
          if (path === '/authorize') return authorize(request, env);
          if (path === '/') return new Response('Working Book — serveur MCP du Suivi. Point d’accès : /mcp\n', { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
          return new Response('Not found', { status: 404 });
        },
      } as never,
      authorizeEndpoint: '/authorize',
      tokenEndpoint: '/token',
      clientRegistrationEndpoint: '/register',
      scopesSupported: ['mcp', 'offline_access'],
      requiredScopes: ['mcp'],
      resourceMetadata: { resource: env.MCP_RESOURCE, resource_name: 'Working Book — Suivi' },
      clientIdMetadataDocumentEnabled: true,
    });
    return provider.fetch(request, env, ctx);
  },
};
