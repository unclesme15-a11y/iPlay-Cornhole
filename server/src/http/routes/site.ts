import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { AppConfig } from '../../config.js';
import type { Services } from '../../services.js';
import { escapeHtml, renderMarkdown } from '../markdown.js';

/**
 * The game's public web pages, the addresses the app and the store listings link to:
 *   /privacy          the privacy policy   (docs/legal/privacy-policy.md, or the draft until that exists)
 *   /terms            the terms of use     (docs/legal/terms.md, or the draft)
 *   /support          help and contact
 *   /delete-account   ask for an account to be deleted without the app (Google Play requires this page)
 * Plain HTML, no scripts, nothing loaded from anywhere else.
 */

const CSP = "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'";

const deletionForm = z.object({
  name: z.string().trim().min(1, 'Enter your player name').max(40, 'Player names are 40 characters at most'),
  contact: z.string().trim().min(3, 'Enter an email address (or other way to reach you)').max(200, 'That contact is too long'),
  accountId: z.string().trim().max(64).optional().default(''),
  details: z.string().trim().max(1000, 'Please keep it under 1,000 characters').optional().default(''),
  website: z.string().optional().default(''), // left empty by people; bots fill it in
});

export function legalDir(config: AppConfig): string {
  if (config.LEGAL_DIR) return path.resolve(config.LEGAL_DIR);
  for (const dir of [path.resolve(process.cwd(), '../docs/legal'), path.resolve(process.cwd(), 'legal')]) {
    if (existsSync(dir)) return dir;
  }
  return path.resolve(process.cwd(), 'legal');
}

/** The final document if it exists, else the draft. null if neither is there. */
export function legalFile(dir: string, doc: 'privacy' | 'terms'): { file: string; draft: boolean } | null {
  const base = doc === 'privacy' ? 'privacy-policy' : 'terms';
  const final = path.join(dir, `${base}.md`);
  if (existsSync(final)) return { file: final, draft: false };
  const draft = path.join(dir, `${base}-draft.md`);
  if (existsSync(draft)) return { file: draft, draft: true };
  return null;
}

export function sitePage(title: string, body: string): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} · iPlay Cornhole</title>
<style>
:root{color-scheme:dark}
body{margin:0;background:#05080b;color:#e3eef4;font:17px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif;padding:24px 16px 64px}
main{max-width:46rem;margin:0 auto}
header{display:flex;gap:1rem;flex-wrap:wrap;align-items:baseline;border-bottom:1px solid #1d2a33;padding-bottom:.75rem;margin-bottom:1.5rem}
header b{color:#0dccf2;letter-spacing:.08em;text-transform:uppercase;font-size:.95rem}
header nav{display:flex;gap:1rem;flex-wrap:wrap;font-size:.95rem}
h1{font-size:1.7rem;line-height:1.2;margin:.2rem 0 1rem;text-wrap:balance}h2{font-size:1.25rem;margin:2rem 0 .6rem;color:#f2d27a}h3{font-size:1.05rem}
a{color:#5fe0fa}p,li{max-width:65ch}code{font:.9em ui-monospace,monospace;background:#101a21;padding:.1em .3em;border-radius:3px}
blockquote{margin:1rem 0;padding:.75rem 1rem;border-left:3px solid #e8b84a;background:#0e161c;color:#c9d7de}
blockquote p{margin:.3rem 0}
.table{overflow-x:auto;margin:1rem 0}table{border-collapse:collapse;min-width:32rem;font-size:.95rem}
th,td{border:1px solid #1d2a33;padding:.5rem .6rem;text-align:left;vertical-align:top}th{background:#0e161c}
label{display:block;margin:1rem 0 .3rem;font-weight:600}
input,textarea{width:100%;box-sizing:border-box;font:inherit;color:inherit;background:#0e161c;border:1px solid #2a3a45;border-radius:6px;padding:.6rem .7rem}
input:focus,textarea:focus{outline:2px solid #0dccf2;outline-offset:1px}
textarea{min-height:7rem}.hint{color:#8fa3b3;font-size:.9rem;margin:.2rem 0 0}
button{margin-top:1.4rem;font:inherit;font-weight:700;color:#05080b;background:#0dccf2;border:0;border-radius:6px;padding:.75rem 1.4rem;cursor:pointer}
button:focus-visible{outline:2px solid #e8b84a;outline-offset:2px}
.error{background:#2a1114;border:1px solid #7a2b33;padding:.75rem 1rem;border-radius:6px}
.hp{position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden}
</style></head><body><main>
<header><b>iPlay Cornhole</b><nav><a href="/support">Support</a><a href="/privacy">Privacy</a><a href="/terms">Terms</a><a href="/delete-account">Delete my account</a></nav></header>
${body}
</main></body></html>`;
}

function send(reply: FastifyReply, status: number, html: string): FastifyReply {
  return reply
    .status(status)
    .type('text/html; charset=utf-8')
    .header('content-security-policy', CSP)
    .header('referrer-policy', 'no-referrer')
    .header('x-content-type-options', 'nosniff')
    .send(html);
}

const contactLine = (config: AppConfig): string =>
  config.SUPPORT_EMAIL ? `<p>Email us at <a href="mailto:${escapeHtml(config.SUPPORT_EMAIL)}">${escapeHtml(config.SUPPORT_EMAIL)}</a>.</p>` : '';

function deletionPage(config: AppConfig, error?: string, values: Record<string, string> = {}): string {
  const v = (k: string): string => escapeHtml(values[k] ?? '');
  return sitePage(
    'Delete my account',
    `<h1>Delete my iPlay Cornhole account</h1>
<p><strong>Quickest way:</strong> in the app, open <em>Profile</em> and tap <em>Delete my account</em>. It happens straight away.</p>
<p>If you no longer have the app, fill in this form and we will delete the account by hand within 30 days, then reply to you. Deleting removes your account, sign-in links, stats, ratings and blocks; in other players' match history your name becomes "Deleted player". What is kept and why is in the <a href="/privacy">privacy policy</a>.</p>
${error ? `<p class="error" role="alert">${escapeHtml(error)}</p>` : ''}
<form method="post" action="/delete-account">
<label for="name">Your player name</label><input id="name" name="name" maxlength="40" required value="${v('name')}">
<label for="contact">Email address (so we can confirm)</label><input id="contact" name="contact" maxlength="200" required value="${v('contact')}">
<label for="accountId">Account id, if you have it</label><input id="accountId" name="accountId" maxlength="64" value="${v('accountId')}">
<p class="hint">It is in the file from Profile &gt; Download my data. It helps us find the right account.</p>
<label for="details">Anything else that helps us find your account (optional)</label><textarea id="details" name="details" maxlength="1000">${v('details')}</textarea>
<div class="hp" aria-hidden="true"><label for="website">Leave this empty</label><input id="website" name="website" tabindex="-1" autocomplete="off"></div>
<button type="submit">Send deletion request</button>
</form>
${contactLine(config)}`,
  );
}

export function registerSiteRoutes(app: FastifyInstance, services: Services): void {
  const { config, db } = services;
  const dir = legalDir(config);

  for (const doc of ['privacy', 'terms'] as const) {
    const found = legalFile(dir, doc);
    if (!found) app.log.warn({ dir, doc }, 'legal page missing: /' + doc + ' will say it is not available');
    else if (found.draft && config.NODE_ENV === 'production') app.log.warn({ file: found.file }, `/${doc} is showing the DRAFT; publish the final version before launch`);

    app.get(`/${doc}`, async (_req, reply) => {
      const f = legalFile(dir, doc);
      const title = doc === 'privacy' ? 'Privacy policy' : 'Terms of use';
      if (!f) return send(reply, 404, sitePage(title, `<h1>${title}</h1><p>This page is not available yet.</p>${contactLine(config)}`));
      return send(reply, 200, sitePage(title, renderMarkdown(readFileSync(f.file, 'utf8'))));
    });
  }

  app.get('/support', async (_req, reply) =>
    send(
      reply,
      200,
      sitePage(
        'Support',
        `<h1>Help and support</h1>
${contactLine(config)}
<h2>Someone is abusing voice chat or cheating</h2>
<p>On the results screen, tap their name, then <em>Report</em>. <em>Block</em> mutes them for you straight away and stops you being matched with them. Reports go to our team.</p>
<h2>I lost my account on a new phone</h2>
<p>Guest accounts live on one phone. If you added <em>Sign in with Apple</em> (iPhone) or <em>Sign in with Google</em> (Android) in your Profile, sign in with it on the new phone. Apple and Google accounts do not move between iPhone and Android.</p>
<h2>My rating changed after someone left</h2>
<p>Leaving a ranked match, or being away for three throws in a row, counts as a loss for the one who left, and they wait before searching again.</p>
<h2>Your data</h2>
<p>Profile &gt; <em>Download my data</em> gives you a copy. Profile &gt; <em>Delete my account</em> deletes it. No app? Use the <a href="/delete-account">deletion request form</a>. Details are in the <a href="/privacy">privacy policy</a>.</p>
<h2>Age</h2>
<p>iPlay Cornhole is for adults (18+). If you think someone under 18 is playing, report them in the game (reason: under 18) or write to us.</p>`,
      ),
    ),
  );

  app.get('/delete-account', async (_req, reply) => send(reply, 200, deletionPage(config)));

  void app.register(async (form) => {
    form.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string', bodyLimit: 8 * 1024 }, (_req, body, done) => {
      done(null, Object.fromEntries(new URLSearchParams(body as string)));
    });
    form.post('/delete-account', { config: { rateLimit: { max: 5, timeWindow: '1 hour' } } }, async (req, reply) => {
      const raw = (req.body ?? {}) as Record<string, string>;
      const parsed = deletionForm.safeParse(raw);
      if (!parsed.success) return send(reply, 400, deletionPage(config, parsed.error.issues[0]?.message ?? 'Please check the form', raw));
      const f = parsed.data;
      if (f.website === '') {
        await db.query(
          'INSERT INTO deletion_requests (id, created_at, display_name, contact, account_id, details) VALUES ($1, $2, $3, $4, $5, $6)',
          [randomUUID(), new Date(), f.name, f.contact, f.accountId || null, f.details || null],
        );
        req.log.info({ deletionRequest: true }, 'account deletion request received');
      }
      return send(
        reply,
        200,
        sitePage(
          'Request received',
          `<h1>We have your request</h1><p>We will delete the account and reply to <strong>${escapeHtml(f.contact)}</strong> within 30 days. If we cannot tell which account is yours, we will ask.</p>${contactLine(config)}`,
        ),
      );
    });
  });
}
