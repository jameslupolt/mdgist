import xss from 'xss';
import { Marked } from 'marked';
import { resolve } from '@std/path';
import { walk } from '@std/fs';
import { SERVER_PORT } from './env.ts';
import { Router } from './router.ts';
import { storage, verifyEditCode } from './storage.ts';
import {
  deletePage,
  editPage,
  errorPage,
  guidePage,
  homePage,
  pastePage,
} from './templates.ts';
import './cron.ts';

interface TocItem {
  level: number;
  text: string;
  anchor: string;
  subitems: TocItem[];
}

const MAX_PASTE_SIZE = 40_000;
const RATE_LIMIT = 1000;
const RATE_WINDOW = 60_000;

const STATIC_ROOT = resolve('./static');
const FILES = new Map<string, string>();
const MIMES: Record<string, string> = {
  'js': 'text/javascript',
  'css': 'text/css',
  'ico': 'image/vnd.microsoft.icon',
};

const XSS_OPTIONS = {
  whiteList: {
    ...xss.whiteList,
    h1: ['id'],
    h2: ['id'],
    h3: ['id'],
    h4: ['id'],
    h5: ['id'],
    h6: ['id'],
    input: ['disabled', 'type', 'checked'],
    div: ['class'],
  },
};

for await (const file of walk(STATIC_ROOT)) {
  if (file.isFile) {
    FILES.set('/' + file.name.normalize(), file.path);
  }
}

// Rate limiting
const rateLimitMap = new Map<string, number[]>();

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  let timestamps = rateLimitMap.get(ip);

  if (!timestamps) {
    timestamps = [];
    rateLimitMap.set(ip, timestamps);
  }

  while (timestamps.length > 0 && now - timestamps[0] > RATE_WINDOW) {
    timestamps.shift();
  }

  if (timestamps.length >= RATE_LIMIT) return false;
  timestamps.push(now);
  return true;
}

setInterval(() => {
  const now = Date.now();
  for (const [ip, timestamps] of rateLimitMap) {
    const recent = timestamps.filter((t) => now - t < RATE_WINDOW);
    if (recent.length === 0) rateLimitMap.delete(ip);
    else rateLimitMap.set(ip, recent);
  }
}, RATE_WINDOW);

// CSRF check for POST requests
function checkCsrf(req: Request): boolean {
  const origin = req.headers.get('origin');
  const host = req.headers.get('host');
  if (!origin || !host) return true;

  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Content-Security-Policy':
    "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'",
};

const app = new Router(SECURITY_HEADERS);

app.get('*', async (req) => {
  const url = new URL(req.url);
  const filepath = FILES.get(url.pathname);

  if (filepath) {
    const [ext] = filepath.split('.').slice(-1);
    const contentType = MIMES[ext] ?? 'text/plain';
    const file = await Deno.open(filepath, { read: true });
    const readableStream = file.readable;
    return new Response(readableStream, {
      status: 200,
      headers: { 'content-type': contentType },
    });
  }
});

app.get('/', () => {
  return new Response(homePage(), {
    status: 200,
    headers: { 'content-type': 'text/html' },
  });
});

app.get('/guide', async () => {
  const guideMd = await Deno.readTextFile('./guide.md');
  const parse = createParser();
  const { html, title } = parse(guideMd, { toc: false });

  return new Response(guidePage({ html, title }), {
    status: 200,
    headers: { 'content-type': 'text/html' },
  });
});

app.get('/:id', async (_req, params) => {
  const id = params.id as string ?? '';
  const res = await storage.get(id);

  if (res.value !== null) {
    const parse = createParser();
    const { paste } = res.value;
    let { html, title } = parse(paste);
    html = xss(html, XSS_OPTIONS);
    if (!title) title = id;

    return new Response(pastePage({ id, html, title }), {
      status: 200,
      headers: { 'content-type': 'text/html' },
    });
  }

  return new Response(errorPage(), {
    status: 404,
    headers: { 'content-type': 'text/html' },
  });
});

app.get('/:id/edit', async (_req, params) => {
  const id = params.id as string ?? '';
  const res = await storage.get(id);

  if (res.value !== null) {
    const { editCodeHash, paste } = res.value;
    const hasEditCode = Boolean(editCodeHash);
    return new Response(editPage({ id, paste, hasEditCode }), {
      status: 200,
      headers: { 'content-type': 'text/html' },
    });
  }

  return new Response(errorPage(), {
    status: 404,
    headers: { 'content-type': 'text/html' },
  });
});

app.get('/:id/delete', async (_req, params) => {
  const id = params.id as string ?? '';
  const res = await storage.get(id);

  if (res.value !== null) {
    const { editCodeHash } = res.value;
    const hasEditCode = Boolean(editCodeHash);
    return new Response(deletePage({ id, hasEditCode }), {
      status: 200,
      headers: { 'content-type': 'text/html' },
    });
  }

  return new Response(errorPage(), {
    status: 404,
    headers: { 'content-type': 'text/html' },
  });
});

app.get('/:id/raw', async (_req, params) => {
  const id = params.id as string ?? '';
  const res = await storage.get(id);

  if (res.value !== null) {
    return new Response(res.value.paste, {
      status: 200,
      headers: { 'content-type': 'text/plain' },
    });
  }

  return new Response(errorPage(), {
    status: 404,
    headers: { 'content-type': 'text/html' },
  });
});

app.post('/save', async (req) => {
  const headers = new Headers({ 'content-type': 'text/html' });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return new Response('Bad Request', { status: 400 });
  }

  const customUrl = (form.get('url') as string) ?? '';
  const paste = (form.get('paste') as string) ?? '';
  const slug = createSlug(customUrl);

  if (paste.length > MAX_PASTE_SIZE) {
    return new Response(
      homePage({
        paste,
        url: customUrl,
        errors: {
          url: `Paste exceeds maximum length of ${MAX_PASTE_SIZE} characters`,
        },
      }),
      { status: 422, headers },
    );
  }

  let editCode: string | undefined = form.get('editcode') as string;
  if (typeof editCode === 'string') {
    editCode = editCode.trim() || undefined;
  }

  if (slug.length > 0) {
    const res = await storage.get(slug);

    if (slug === 'guide' || res.value !== null) {
      return new Response(
        homePage({
          paste,
          url: customUrl,
          errors: { url: `URL unavailable: ${customUrl}` },
        }),
        { status: 422, headers },
      );
    }

    await storage.set(slug, paste, editCode);
    headers.set('location', '/' + slug.trim());
    return new Response('', { status: 302, headers });
  }

  let id = '';
  let exists = true;

  for (; exists;) {
    id = generateId();
    exists = await storage.get(id).then((r) => r.value !== null);
  }

  await storage.set(id, paste, editCode);
  headers.set('location', '/' + id.trim());
  return new Response('', { status: 302, headers });
});

app.post('/:id/save', async (req, params) => {
  const id = params.id as string ?? '';
  const headers = new Headers({ 'content-type': 'text/html' });

  if (id.trim().length === 0) {
    headers.set('location', '/');
    return new Response('', { status: 302, headers });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return new Response('Bad Request', { status: 400 });
  }

  const paste = (form.get('paste') as string) ?? '';

  if (paste.length > MAX_PASTE_SIZE) {
    return new Response('Paste too large', { status: 422, headers });
  }

  let editCode: string | undefined = form.get('editcode') as string;
  if (typeof editCode === 'string') {
    editCode = editCode.trim() || undefined;
  }

  const res = await storage.get(id);
  if (res.value === null) {
    return new Response(errorPage(), { status: 404, headers });
  }

  const existing = res.value;
  const hasEditCode = Boolean(existing.editCodeHash);

  if (hasEditCode) {
    if (
      !editCode ||
      !(await verifyEditCode(editCode, existing.editCodeHash!))
    ) {
      return new Response(
        editPage({
          id,
          paste,
          hasEditCode,
          errors: { editCode: 'Invalid edit code' },
        }),
        { status: 400, headers },
      );
    }
  }

  await storage.update(id, paste, existing.editCodeHash);
  headers.set('location', '/' + id);
  return new Response('', { status: 302, headers });
});

app.post('/:id/delete', async (req, params) => {
  const id = params.id as string ?? '';
  const headers = new Headers({ 'content-type': 'text/html' });

  if (id.trim().length === 0) {
    headers.set('location', '/');
    return new Response('', { status: 302, headers });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return new Response('Bad Request', { status: 400 });
  }

  let editCode: string | undefined = form.get('editcode') as string;
  if (typeof editCode === 'string') {
    editCode = editCode.trim() || undefined;
  }

  const res = await storage.get(id);
  if (res.value === null) {
    return new Response(errorPage(), { status: 404, headers });
  }

  const existing = res.value;
  const hasEditCode = Boolean(existing.editCodeHash);

  if (hasEditCode) {
    if (
      !editCode ||
      !(await verifyEditCode(editCode, existing.editCodeHash!))
    ) {
      return new Response(
        deletePage({
          id,
          hasEditCode,
          errors: { editCode: 'Invalid edit code' },
        }),
        { status: 400, headers },
      );
    }
  }

  await storage.delete(id);
  headers.set('location', '/');
  return new Response('', { status: 302, headers });
});

Deno.serve({ port: Number(SERVER_PORT) }, (req, info) => {
  const url = new URL(req.url);

  // Skip rate limiting for static files
  if (!FILES.has(url.pathname)) {
    const ip = info.remoteAddr.hostname;

    if (!checkRateLimit(ip)) {
      return new Response('Too Many Requests', {
        status: 429,
        headers: { 'Retry-After': '60' },
      });
    }
  }

  if (req.method === 'POST' && !checkCsrf(req)) {
    return new Response('Forbidden', { status: 403 });
  }

  return app.handler(req);
});

// deno-lint-ignore no-explicit-any
type MarkedToken = { tokens: any[]; depth: number };

function createParser() {
  const tocItems: TocItem[] = [];

  const renderer = {
    // deno-lint-ignore no-explicit-any
    heading(this: any, { tokens, depth }: MarkedToken) {
      const text: string = this.parser.parseInline(tokens);
      const anchor = createSlug(text);
      const newItem = { level: depth, text, anchor, subitems: [] };

      tocItems.push(newItem);
      return `<h${depth} id="${anchor}"><a href="#${anchor}">${text}</a></h${depth}>`;
    },
  };

  const marked = new Marked({ renderer, breaks: true });
  const parse = (markdown: string, { toc = true } = {}) => {
    let html = marked.parse(markdown) as string;
    const title = tocItems[0] ? tocItems[0].text : '';

    if (toc) {
      const tocHtml = buildToc(tocItems);
      if (tocHtml) html = html.replace(/\[\[\[TOC\]\]\]/g, tocHtml);
    }

    return { title, html };
  };

  return parse;
}

function createSlug(text = '') {
  const lines = text.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const slug = lines[i].toString().toLowerCase()
      .replace(/<[^>]*>/g, '') // strip HTML tags
      .replace(/\s+/g, '-')
      .replace(/[^\w\-]+/g, '')
      .replace(/\-\-+/g, '-')
      .replace(/^-+/, '')
      .replace(/-+$/, '');

    if (slug.length > 0) return slug;
  }

  return '';
}

function generateId(): string {
  const chars = '0123456789abcdefghijklmnopqrstuvwxyz';
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (b) => chars[b % 36]).join('');
}

function buildToc(items: TocItem[] = []) {
  let html = '';

  while (items.length > 0) {
    html += buildNestedList(items, 1);
  }

  return html ? `<div class="toc">${html}</div>` : html;
}

function buildNestedList(items: TocItem[] = [], level: number) {
  let html = '<ul>';

  while (items.length > 0 && items[0].level === level) {
    const item = items.shift();
    if (item) html += `<li><a href="#${item.anchor}">${item.text}</a></li>`;
  }

  while (items.length > 0 && items[0].level > level) {
    html += buildNestedList(items, level + 1);
  }

  return html + '</ul>';
}
