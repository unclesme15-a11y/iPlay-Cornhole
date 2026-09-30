import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { renderMarkdown } from '../src/http/markdown.js';
import { TestEnv } from './helpers/app.js';

const ADMIN = 'a'.repeat(40);
let env: TestEnv;
beforeAll(async () => {
  env = await TestEnv.create();
});
afterAll(async () => {
  await env.destroy();
});
afterEach(async () => {
  await env.closeAll();
});

const form = (fields: Record<string, string>) => ({
  payload: new URLSearchParams(fields).toString(),
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
});

describe('markdown for the legal pages', () => {
  it('renders headings, paragraphs, lists, quotes, tables, emphasis and links', () => {
    const html = renderMarkdown(
      '# Title\n\nSome **bold** and *soft* text\nover two lines.\n\n> A note\n> more\n\n- one\n- two with [a link](https://example.com/x?a=1&b=2)\n\n1. first\n2. second\n\n| A | B |\n|---|---|\n| `x` | y |\n',
    );
    expect(html).toContain('<h1>Title</h1>');
    expect(html).toContain('<p>Some <strong>bold</strong> and <em>soft</em> text over two lines.</p>');
    expect(html).toContain('<blockquote><p>A note more</p></blockquote>');
    expect(html).toContain('<ul><li>one</li><li>two with <a href="https://example.com/x?a=1&amp;b=2">a link</a></li></ul>');
    expect(html).toContain('<ol><li>first</li><li>second</li></ol>');
    expect(html).toContain('<th>A</th><th>B</th>');
    expect(html).toContain('<td><code>x</code></td><td>y</td>');
  });

  it('never lets markup or unsafe links through', () => {
    const html = renderMarkdown('Hello <script>alert(1)</script> [x](javascript:alert(1)) [y](//evil.example) [z](/\\evil.example) <img src=x onerror=alert(1)>\n\n| <b>c</b> |\n|---|\n| "q" |');
    expect(html).not.toMatch(/<script|<img|<b>|href="javascript|href="\/\/|href="\/\\/);
    expect(renderMarkdown('[ok](/support)')).toBe('<p><a href="/support">ok</a></p>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&quot;q&quot;');
  });

  it('keeps [brackets] that are not links, and does not format inside code', () => {
    expect(renderMarkdown('Contact [contact email] or `**not bold**`')).toBe('<p>Contact [contact email] or <code>**not bold**</code></p>');
  });

  it('renders the real legal drafts without losing text', () => {
    for (const file of ['privacy-policy-draft.md', 'terms-draft.md']) {
      const md = readFileSync(path.resolve(__dirname, '../../docs/legal', file), 'utf8');
      const html = renderMarkdown(md);
      expect(html).toContain('<h1>');
      expect(html).not.toContain('|---');
      expect(html).not.toMatch(/(^|\n)\s*[-#>]\s/); // no raw list/heading/quote markers left
    }
  });
});

describe('public pages', () => {
  it('serves the privacy policy and terms (the drafts until final versions exist), with a strict security policy', async () => {
    const t = await env.boot();
    for (const url of ['/privacy', '/terms', '/support', '/delete-account']) {
      const res = await t.app.inject({ method: 'GET', url });
      expect(res.statusCode, url).toBe(200);
      expect(res.headers['content-type']).toContain('text/html');
      expect(res.headers['content-security-policy']).toContain("default-src 'none'");
    }
    expect((await t.app.inject({ method: 'GET', url: '/privacy' })).body).toContain('Privacy Policy');
    expect((await t.app.inject({ method: 'GET', url: '/terms' })).body).toContain('Terms of Use');
  });

  it('prefers the final documents over the drafts, and says so when a page is missing', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'legal-'));
    writeFileSync(path.join(dir, 'privacy-policy-draft.md'), '# Draft privacy');
    writeFileSync(path.join(dir, 'privacy-policy.md'), '# Final privacy');
    const t = await env.boot({ env: { LEGAL_DIR: dir, SUPPORT_EMAIL: 'help@iplay.example' } });
    expect((await t.app.inject({ method: 'GET', url: '/privacy' })).body).toContain('<h1>Final privacy</h1>');
    const terms = await t.app.inject({ method: 'GET', url: '/terms' });
    expect(terms.statusCode).toBe(404);
    expect(terms.body).toContain('help@iplay.example');
  });

  it('lists the page addresses in /api/meta for the app', async () => {
    const t = await env.boot({ env: { PUBLIC_BASE_URL: 'https://cornhole.example.com/' } });
    expect((await t.call(null, 'GET', '/api/meta')).json().links).toEqual({
      privacy: 'https://cornhole.example.com/privacy',
      terms: 'https://cornhole.example.com/terms',
      support: 'https://cornhole.example.com/support',
      deleteAccount: 'https://cornhole.example.com/delete-account',
    });
  });
});

describe('account deletion requests from the website', () => {
  it('stores a request and shows a confirmation; staff list it, find the account, delete it and mark it done', async () => {
    const t = await env.boot({ env: { ADMIN_TOKEN: ADMIN } });
    const g = await t.guest('Gone Player');
    const res = await t.app.inject({ method: 'POST', url: '/delete-account', ...form({ name: 'Gone Player', contact: 'me@example.com', details: 'lost my phone' }) });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('We have your request');
    expect(res.body).toContain('me@example.com');

    const admin = { authorization: `Bearer ${ADMIN}` };
    const list = (await t.call(null, 'GET', '/admin/deletion-requests', undefined, admin)).json().requests;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ displayName: 'Gone Player', contact: 'me@example.com', accountId: null, details: 'lost my phone', status: 'open' });

    const found = (await t.call(null, 'GET', '/admin/accounts?name=gone%20player', undefined, admin)).json().accounts;
    expect(found.map((a: { id: string }) => a.id)).toEqual([g.id]);
    expect(Date.parse(found[0].lastSeenAt)).toBeGreaterThan(0); // staff check this before deleting (docs/operations.md)
    expect(Date.parse((await t.call(null, 'GET', `/admin/accounts/${g.id}`, undefined, admin)).json().account.lastSeenAt)).toBeGreaterThan(0);
    expect((await t.call(null, 'POST', `/admin/accounts/${g.id}/delete`, {}, admin)).json()).toEqual({ deleted: true });
    expect((await t.call(g.token, 'GET', '/api/me')).statusCode).toBe(401);
    expect((await t.call(null, 'GET', `/admin/accounts/${g.id}`, undefined, admin)).statusCode).toBe(404);

    const done = await t.call(null, 'POST', `/admin/deletion-requests/${list[0].id}`, { status: 'done', note: 'deleted' }, admin);
    expect(done.json()).toEqual({ id: list[0].id, status: 'done' });
    expect((await t.call(null, 'GET', '/admin/deletion-requests', undefined, admin)).json().requests).toHaveLength(0);
    expect((await t.call(null, 'GET', '/admin/deletion-requests?status=all', undefined, admin)).json().requests[0]).toMatchObject({ status: 'done', note: 'deleted' });
    expect((await t.call(null, 'POST', '/admin/deletion-requests/nope', { status: 'done' }, admin)).statusCode).toBe(404);
  });

  it('shows the form again with the problem when something is missing, keeping what was typed (escaped)', async () => {
    const t = await env.boot();
    const res = await t.app.inject({ method: 'POST', url: '/delete-account', ...form({ name: '<b>x</b>', contact: '' }) });
    expect(res.statusCode).toBe(400);
    expect(res.body).toContain('Enter an email address');
    expect(res.body).toContain('value="&lt;b&gt;x&lt;/b&gt;"');
    expect((await t.services.db.query('SELECT 1 FROM deletion_requests')).rows).toHaveLength(0);
  });

  it('quietly ignores bots that fill in the hidden field', async () => {
    const t = await env.boot();
    const res = await t.app.inject({ method: 'POST', url: '/delete-account', ...form({ name: 'Bot', contact: 'bot@example.com', website: 'http://spam' }) });
    expect(res.statusCode).toBe(200);
    expect((await t.services.db.query('SELECT 1 FROM deletion_requests')).rows).toHaveLength(0);
  });

  it('limits requests to 5 an hour from one address', async () => {
    const t = await env.boot({ env: { TRUST_PROXY: 'true' } });
    const codes: number[] = [];
    for (let i = 0; i < 6; i++) {
      const r = await t.app.inject({ method: 'POST', url: '/delete-account', ...form({ name: `P${i}`, contact: 'x@example.com' }), remoteAddress: '10.9.8.7' });
      codes.push(r.statusCode);
    }
    expect(codes).toEqual([200, 200, 200, 200, 200, 429]);
  });

  it('staff routes need the admin token', async () => {
    const t = await env.boot({ env: { ADMIN_TOKEN: ADMIN } });
    expect((await t.call(null, 'GET', '/admin/deletion-requests')).statusCode).toBe(401);
    expect((await t.call(null, 'POST', '/admin/accounts/x/delete', {})).statusCode).toBe(401);
  });
});
