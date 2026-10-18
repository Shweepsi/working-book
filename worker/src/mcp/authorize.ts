// The one page of the OAuth flow that is ours: whoever connects Claude to this
// server (claude.ai, the mobile app, Claude Code) lands here once, types the
// passphrase (the MCP_PASSPHRASE secret) and allows the client. One user, no
// accounts: the passphrase is the sign-in.

import { AuthorizationError, CimdFetchError, type ConsentDescription, type OAuthHelpers } from '@cloudflare/workers-oauth-provider';

export interface AuthEnv {
  OAUTH_PROVIDER: OAuthHelpers;
  MCP_PASSPHRASE?: string;
}

export const USER_ID = 'owner';
const SCOPES = ['mcp', 'offline_access'];

const escape = (value: string) => value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function page(title: string, body: string, status = 200, headers = new Headers()): Response {
  headers.set('Content-Type', 'text/html; charset=utf-8');
  return new Response(
    `<!doctype html><html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escape(title)}</title>
<style>
:root{color-scheme:light dark;--bg:#f6f7f9;--fg:#1d2330;--muted:#5d6676;--card:#fff;--line:#d9dde4;--accent:#2557d6}
@media (prefers-color-scheme:dark){:root{--bg:#14171c;--fg:#e8ebf0;--muted:#9aa3b2;--card:#1d2128;--line:#323844;--accent:#7ea2ff}}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,sans-serif;padding:24px 16px}
main{max-width:440px;margin:0 auto;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:24px}
h1{font-size:20px;margin:0 0 12px}p{margin:8px 0;color:var(--muted)}strong{color:var(--fg)}
label{display:block;margin:16px 0 6px;font-weight:600}
input[type=password]{box-sizing:border-box;width:100%;padding:10px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--fg);font:inherit}
.row{display:flex;gap:8px;margin-top:16px}button{flex:1;padding:10px;border-radius:8px;border:1px solid var(--line);background:var(--bg);color:var(--fg);font:inherit;cursor:pointer}
button.primary{background:var(--accent);border-color:var(--accent);color:#fff}.warn{color:#c2410c}
</style>
<main>${body}</main></html>`,
    { status, headers },
  );
}

function consentPage(d: ConsentDescription | null, handle: string, error?: string): string {
  const who = d
    ? `<p><strong>${escape(d.clientName)}</strong> ${d.clientDomain ? `(publié par <strong>${escape(d.clientDomain)}</strong>)` : '(nom déclaré par l’application, non vérifié)'} demande l’accès aux classeurs Suivi de Working Book.</p>
<p>L’accès sera envoyé à <strong>${escape(d.redirectHost)}</strong>.</p>
${d.redirectIsLoopback ? '<p class="warn">L’accès part vers une application de cet ordinateur : continue seulement si tu viens de lancer la connexion depuis elle.</p>' : ''}`
    : '';
  return `<h1>Connecter Claude au Suivi</h1>${who}
${error ? `<p class="warn">${escape(error)}</p>` : ''}
<form method="post">
<input type="hidden" name="handle" value="${escape(handle)}">
<label for="pass">Phrase secrète</label>
<input id="pass" name="passphrase" type="password" autocomplete="current-password" autofocus>
<div class="row"><button name="decision" value="deny">Refuser</button><button class="primary" name="decision" value="approve">Autoriser</button></div>
</form>`;
}

/** Constant-time comparison of two strings. */
async function same(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [x, y] = await Promise.all([crypto.subtle.digest('SHA-256', enc.encode(a)), crypto.subtle.digest('SHA-256', enc.encode(b))]);
  return crypto.subtle.timingSafeEqual(x, y);
}

export async function authorize(request: Request, env: AuthEnv): Promise<Response> {
  const oauth = env.OAUTH_PROVIDER;
  try {
    if (request.method === 'GET') {
      const auth = await oauth.parseAuthRequest(request);
      const details = await oauth.describeConsent(auth);
      const consent = await oauth.beginConsent(auth);
      return page('Connecter Claude au Suivi', consentPage(details, consent.handle), 200, consent.headers);
    }
    if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });
    const form = await request.formData();
    const handle = String(form.get('handle') ?? '');
    if (form.get('decision') !== 'approve') {
      const denied = await oauth.denyConsent(request, handle);
      return new Response(null, { status: 302, headers: denied.headers });
    }
    const secret = env.MCP_PASSPHRASE ?? '';
    if (secret.length < 16 || !(await same(String(form.get('passphrase') ?? ''), secret))) {
      // Slow down guessing; the handle isn't used up, so the same form works again.
      await new Promise((r) => setTimeout(r, 1500));
      return page('Phrase incorrecte', consentPage(null, handle, 'Phrase secrète incorrecte.'), 403);
    }
    const approved = await oauth.approveConsent(request, handle);
    const scope = approved.request.scope.filter((s) => SCOPES.includes(s));
    const { redirectTo } = await oauth.completeAuthorization({
      request: approved.request,
      userId: USER_ID,
      metadata: {},
      scope: scope.length ? scope : ['mcp'],
      props: { userId: USER_ID },
    });
    approved.headers.set('Location', redirectTo);
    return new Response(null, { status: 302, headers: approved.headers });
  } catch (error) {
    if (error instanceof AuthorizationError && error.redirectTo) return Response.redirect(error.redirectTo, 302);
    if (error instanceof AuthorizationError || error instanceof CimdFetchError) {
      const message = error instanceof AuthorizationError ? error.description : 'Cette application n’a pas pu être vérifiée.';
      return page('Connexion impossible', `<h1>Connexion impossible</h1><p>${escape(message)}</p><p>Relance la connexion depuis Claude.</p>`, 400);
    }
    throw error;
  }
}
