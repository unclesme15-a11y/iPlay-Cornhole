import type { FastifyInstance } from 'fastify';
import { DomainError } from '../../core/errors.js';
import type { Services } from '../../services.js';

const CODE = /^[A-Za-z0-9]{8}$/;

const escapeHtml = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

/** Small standalone page for people who tap an invite link. It has no scripts and loads nothing from anywhere else. */
export function joinPage(opts: { code: string; hostName: string | null; open: boolean; deepLink: string; iosUrl?: string | undefined; androidUrl?: string | undefined }): string {
  const host = opts.hostName ? escapeHtml(opts.hostName) : 'A friend';
  const title = opts.open ? `${host} invited you to play cornhole` : 'This invite has expired';
  const stores = [
    opts.iosUrl ? `<a class="store" href="${escapeHtml(opts.iosUrl)}">Get it on iPhone</a>` : '',
    opts.androidUrl ? `<a class="store" href="${escapeHtml(opts.androidUrl)}">Get it on Android</a>` : '',
  ].join('');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>iPlay Cornhole</title>
<meta property="og:title" content="${title}">
<meta property="og:description" content="Join the match with code ${escapeHtml(opts.code.toUpperCase())} in iPlay Cornhole.">
<meta name="robots" content="noindex">
<style>
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#070b10;color:#e8f2f8;font:18px/1.4 system-ui,sans-serif;text-align:center;padding:24px}
main{max-width:22rem}h1{font-size:1.6rem;margin:0 0 .5rem}.code{font:700 2rem/1 ui-monospace,monospace;letter-spacing:.2em;color:#00e5ff;margin:1rem 0}
a{display:block;margin:.6rem 0;padding:.9rem 1rem;border-radius:.7rem;text-decoration:none;color:#eaffff;background:#062a33;border:1px solid #00e5ff;font-weight:700}
a.store{background:#18212b;border-color:#243241;font-weight:500}p{color:#8fa3b3}
</style></head><body><main>
<h1>${title}</h1>
${opts.open ? `<div class="code">${escapeHtml(opts.code.toUpperCase())}</div><a href="${escapeHtml(opts.deepLink)}">Open in iPlay Cornhole</a>${stores}<p>No app yet? Install it, then open this link again.</p>` : '<p>Ask your friend for a new one.</p>'}
</main></body></html>`;
}

export function registerInviteRoutes(app: FastifyInstance, services: Services): void {
  const { config, registry } = services;

  // What the join screen shows before someone commits to a seat. Public: anyone with the code.
  app.get<{ Params: { code: string } }>('/api/invites/:code', async (req) => {
    const session = CODE.test(req.params.code) ? registry.get(req.params.code) : undefined;
    if (!session || session.isOver) throw new DomainError('invite_expired', 'This invite has expired', 404);
    return session.invitePreview();
  });

  // The link a friend taps. Opens the app when it is installed (via universal links) or shows this page.
  app.get<{ Params: { code: string } }>('/join/:code', async (req, reply) => {
    const session = CODE.test(req.params.code) ? registry.get(req.params.code) : undefined;
    const open = Boolean(session && !session.isOver && session.invitePreview().canJoin);
    const code = CODE.test(req.params.code) ? req.params.code : 'XXXXXXXX';
    return reply
      .type('text/html; charset=utf-8')
      .header('content-security-policy', "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'")
      .header('referrer-policy', 'no-referrer')
      .header('x-content-type-options', 'nosniff')
      .send(
        joinPage({
          code,
          hostName: open ? (session?.hostName ?? null) : null,
          open,
          deepLink: `${config.DEEP_LINK_SCHEME}://join/${code.toUpperCase()}`,
          iosUrl: config.IOS_STORE_URL,
          androidUrl: config.ANDROID_STORE_URL,
        }),
      );
  });

  // These two files let iPhones and Androids open /join links straight in the app. They only exist once the app ids are set.
  app.get('/.well-known/apple-app-site-association', async (_req, reply) => {
    if (!config.APPLE_TEAM_ID || !config.IOS_BUNDLE_ID) return reply.status(404).send({ error: { code: 'not_found', message: 'Not found' } });
    return reply.type('application/json').send({
      applinks: { apps: [], details: [{ appID: `${config.APPLE_TEAM_ID}.${config.IOS_BUNDLE_ID}`, paths: ['/join/*'] }] },
    });
  });

  app.get('/.well-known/assetlinks.json', async (_req, reply) => {
    if (!config.ANDROID_PACKAGE || config.ANDROID_CERT_SHA256.length === 0) {
      return reply.status(404).send({ error: { code: 'not_found', message: 'Not found' } });
    }
    return reply.type('application/json').send([
      {
        relation: ['delegate_permission/common.handle_all_urls'],
        target: { namespace: 'android_app', package_name: config.ANDROID_PACKAGE, sha256_cert_fingerprints: config.ANDROID_CERT_SHA256 },
      },
    ]);
  });
}
