import xss from 'xss';
import { Marked } from 'marked';
import hljs from 'highlight.js';
import { walk } from '@std/fs';
import { SERVER_PORT } from './env.ts';
import { Router } from './router.ts';
import {
  hashPassword,
  storage,
  verifyEditCode,
  verifyPassword,
} from './storage.ts';
import {
  deletePage,
  editPage,
  errorPage,
  guidePage,
  historyPage,
  homePage,
  passwordPage,
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
const MAX_CUSTOM_URL_LENGTH = 40;
const MIN_PASSWORD_LENGTH = 3;
const MAX_PASSWORD_LENGTH = 128;
const RATE_LIMIT = 1000;
const RATE_WINDOW = 60_000;
const DEFAULT_TTL = 2_592_000_000;
const ALLOWED_TTL_VALUES = new Set([
  3_600_000,
  86_400_000,
  604_800_000,
  2_592_000_000,
]);
const RESERVED_SLUGS = new Set([
  'guide',
  'cli',
  'api',
  'raw',
  'edit',
  'delete',
  'history',
  'save',
  'health',
  'metrics',
]);

const STATIC_ROOT = './static';
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
    span: ['class'],
    code: ['class'],
    pre: ['class'],
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

const HTML_HEADERS = { 'content-type': 'text/html; charset=utf-8' };
const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };
const APP_START_MS = Date.now();
const metrics = {
  requests: 0,
  errors: 0,
  rateLimited: 0,
};

function parseTtl(raw: unknown): number | null {
  if (raw === undefined || raw === null || raw === '') return DEFAULT_TTL;
  const ttl = Number(raw);
  if (!Number.isInteger(ttl) || ttl <= 0 || !ALLOWED_TTL_VALUES.has(ttl)) {
    return null;
  }
  return ttl;
}

function logError(context: string, error: unknown) {
  metrics.errors += 1;
  console.error(`[${context}]`, error);
}

function normalizePassword(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const password = raw.trim();
  return password.length > 0 ? password : undefined;
}

function passwordCookieName(id: string): string {
  return `mdgist_pw_${id}`;
}

function getCookie(req: Request, name: string): string | undefined {
  const cookieHeader = req.headers.get('cookie');
  if (!cookieHeader) return undefined;

  const pairs = cookieHeader.split(';');
  for (const pair of pairs) {
    const [key, ...rest] = pair.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }

  return undefined;
}

function buildPasswordCookie(
  req: Request,
  id: string,
  password: string,
): string {
  const secure = new URL(req.url).protocol === 'https:' ? '; Secure' : '';
  return `${passwordCookieName(id)}=${encodeURIComponent(password)}; Path=/${
    encodeURIComponent(id)
  }; HttpOnly; SameSite=Lax; Max-Age=2592000${secure}`;
}

function resolvePassword(req: Request, id: string): string | undefined {
  const url = new URL(req.url);
  return normalizePassword(url.searchParams.get('password')) ??
    normalizePassword(req.headers.get('x-paste-password')) ??
    normalizePassword(getCookie(req, passwordCookieName(id)));
}

function sanitizeNextPath(id: string, next?: string): string {
  if (!next) return `/${id}`;
  if (next === `/${id}` || next.startsWith(`/${id}/`)) return next;
  return `/${id}`;
}

function passwordBootstrapRedirect(
  req: Request,
  id: string,
  password?: string,
): Response | undefined {
  if (!password) return undefined;

  const url = new URL(req.url);
  const queryPassword = normalizePassword(url.searchParams.get('password'));
  if (!queryPassword || queryPassword !== password) return undefined;

  url.searchParams.delete('password');
  const location = url.pathname +
    (url.searchParams.size ? `?${url.searchParams.toString()}` : '');
  const headers = new Headers(HTML_HEADERS);
  headers.set('location', location);
  headers.set('set-cookie', buildPasswordCookie(req, id, password));
  return new Response('', { status: 302, headers });
}

async function hasPastePasswordAccess(
  req: Request,
  id: string,
  passwordHash?: string,
): Promise<{ ok: boolean; password?: string; bootstrap?: Response }> {
  if (!passwordHash) return { ok: true };

  const password = resolvePassword(req, id);
  if (!password) return { ok: false };

  const valid = await verifyPassword(password, passwordHash);
  if (!valid) return { ok: false };

  return {
    ok: true,
    password,
    bootstrap: passwordBootstrapRedirect(req, id, password),
  };
}

function lockedPage(id: string, next: string) {
  return new Response(passwordPage({ id, next }), {
    status: 401,
    headers: HTML_HEADERS,
  });
}

const app = new Router(SECURITY_HEADERS);

// Static files
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
      headers: {
        'content-type': contentType,
        'cache-control': 'public, max-age=86400',
      },
    });
  }
});

// Home
app.get('/', () => {
  return new Response(homePage(), {
    status: 200,
    headers: HTML_HEADERS,
  });
});

app.get('/health', () => {
  const uptimeSeconds = Math.floor((Date.now() - APP_START_MS) / 1000);
  return new Response(JSON.stringify({ status: 'ok', uptimeSeconds }), {
    status: 200,
    headers: JSON_HEADERS,
  });
});

app.get('/metrics', () => {
  const uptimeSeconds = Math.floor((Date.now() - APP_START_MS) / 1000);
  return new Response(JSON.stringify({ ...metrics, uptimeSeconds }), {
    status: 200,
    headers: JSON_HEADERS,
  });
});

// Guide
app.get('/guide', async () => {
  const guideMd = await Deno.readTextFile('./guide.md');
  const parse = createParser();
  const { html, title } = parse(guideMd, { toc: false });

  return new Response(guidePage({ html, title }), {
    status: 200,
    headers: HTML_HEADERS,
  });
});

// CLI
app.get('/cli', async () => {
  const cliMd = await Deno.readTextFile('./cli.md');
  const parse = createParser();
  const { html, title } = parse(cliMd, { toc: false });

  return new Response(guidePage({ html, title }), {
    status: 200,
    headers: HTML_HEADERS,
  });
});

// View paste
app.get('/:id', async (req, params) => {
  const id = params.id as string ?? '';

  try {
    const res = await storage.get(id);

    if (res.value !== null) {
      const access = await hasPastePasswordAccess(
        req,
        id,
        res.value.passwordHash,
      );
      if (!access.ok) return lockedPage(id, `/${id}`);
      if (access.bootstrap) return access.bootstrap;

      const parse = createParser();
      const { paste } = res.value;
      let { html, title } = parse(paste);
      html = xss(html, XSS_OPTIONS);
      if (!title) title = id;

      return new Response(pastePage({ id, html, title, hasEditCode: Boolean(res.value.editCodeHash) }), {
        status: 200,
        headers: HTML_HEADERS,
      });
    }
  } catch (error) {
    logError('GET /:id', error);
    return new Response('Internal Server Error', { status: 500 });
  }

  return new Response(errorPage(), {
    status: 404,
    headers: HTML_HEADERS,
  });
});

// Edit paste
app.get('/:id/edit', async (req, params) => {
  const id = params.id as string ?? '';

  try {
    const res = await storage.get(id);

    if (res.value !== null) {
      const access = await hasPastePasswordAccess(
        req,
        id,
        res.value.passwordHash,
      );
      if (!access.ok) return lockedPage(id, `/${id}/edit`);
      if (access.bootstrap) return access.bootstrap;

      const { editCodeHash, paste } = res.value;
      const hasEditCode = Boolean(editCodeHash);
      return new Response(editPage({ id, paste, hasEditCode }), {
        status: 200,
        headers: HTML_HEADERS,
      });
    }
  } catch (error) {
    logError('GET /:id/edit', error);
    return new Response('Internal Server Error', { status: 500 });
  }

  return new Response(errorPage(), {
    status: 404,
    headers: HTML_HEADERS,
  });
});

// Delete paste page
app.get('/:id/delete', async (req, params) => {
  const id = params.id as string ?? '';

  try {
    const res = await storage.get(id);

    if (res.value !== null) {
      if (!res.value.editCodeHash) {
        return new Response(errorPage(), { status: 404, headers: HTML_HEADERS });
      }

      const access = await hasPastePasswordAccess(
        req,
        id,
        res.value.passwordHash,
      );
      if (!access.ok) return lockedPage(id, `/${id}/delete`);
      if (access.bootstrap) return access.bootstrap;

      return new Response(deletePage({ id, hasEditCode: true }), {
        status: 200,
        headers: HTML_HEADERS,
      });
    }
  } catch (error) {
    logError('GET /:id/delete', error);
    return new Response('Internal Server Error', { status: 500 });
  }

  return new Response(errorPage(), {
    status: 404,
    headers: HTML_HEADERS,
  });
});

// Raw paste
app.get('/:id/raw', async (req, params) => {
  const id = params.id as string ?? '';

  try {
    const res = await storage.get(id);

    if (res.value !== null) {
      const access = await hasPastePasswordAccess(
        req,
        id,
        res.value.passwordHash,
      );
      if (!access.ok) {
        return new Response('Password required', { status: 401 });
      }
      if (access.bootstrap) return access.bootstrap;

      return new Response(res.value.paste, {
        status: 200,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      });
    }
  } catch (error) {
    logError('GET /:id/raw', error);
    return new Response('Internal Server Error', { status: 500 });
  }

  return new Response(errorPage(), {
    status: 404,
    headers: HTML_HEADERS,
  });
});

// Edit history list
app.get('/:id/history', async (req, params) => {
  const id = params.id as string ?? '';

  try {
    const res = await storage.get(id);
    if (res.value === null) {
      return new Response(errorPage(), { status: 404, headers: HTML_HEADERS });
    }

    const access = await hasPastePasswordAccess(
      req,
      id,
      res.value.passwordHash,
    );
    if (!access.ok) return lockedPage(id, `/${id}/history`);
    if (access.bootstrap) return access.bootstrap;

    const versions = await storage.getHistory(id);
    return new Response(historyPage({ id, versions }), {
      status: 200,
      headers: HTML_HEADERS,
    });
  } catch (error) {
    logError('GET /:id/history', error);
    return new Response('Internal Server Error', { status: 500 });
  }
});

// View specific history version
app.get('/:id/history/:timestamp', async (req, params) => {
  const id = params.id as string ?? '';
  const timestamp = Number(params.timestamp);

  if (isNaN(timestamp)) {
    return new Response(errorPage(), { status: 404, headers: HTML_HEADERS });
  }

  try {
    const latest = await storage.get(id);
    if (latest.value === null) {
      return new Response(errorPage(), { status: 404, headers: HTML_HEADERS });
    }

    const access = await hasPastePasswordAccess(
      req,
      id,
      latest.value.passwordHash,
    );
    if (!access.ok) return lockedPage(id, `/${id}/history/${timestamp}`);
    if (access.bootstrap) return access.bootstrap;

    const res = await storage.getVersion(id, timestamp);

    if (res.value !== null) {
      const parse = createParser();
      const { paste } = res.value;
      let { html, title } = parse(paste);
      html = xss(html, XSS_OPTIONS);
      if (!title) {
        title = `${id} (${
          new Date(timestamp).toISOString().replace('T', ' ').replace(
            /\.\d+Z/,
            ' UTC',
          )
        })`;
      }

      return new Response(pastePage({ id, html, title }), {
        status: 200,
        headers: HTML_HEADERS,
      });
    }
  } catch (error) {
    logError('GET /:id/history/:timestamp', error);
    return new Response('Internal Server Error', { status: 500 });
  }

  return new Response(errorPage(), {
    status: 404,
    headers: HTML_HEADERS,
  });
});

// API: Get paste
app.get('/api/:id', async (req, params) => {
  const id = params.id as string ?? '';

  try {
    const res = await storage.get(id);

    if (res.value !== null) {
      const access = await hasPastePasswordAccess(
        req,
        id,
        res.value.passwordHash,
      );
      if (!access.ok) {
        return new Response(JSON.stringify({ error: 'Password required' }), {
          status: 401,
          headers: JSON_HEADERS,
        });
      }

      return new Response(
        JSON.stringify({
          id,
          paste: res.value.paste,
          hasEditCode: Boolean(res.value.editCodeHash),
          hasPassword: Boolean(res.value.passwordHash),
        }),
        { status: 200, headers: JSON_HEADERS },
      );
    }
  } catch (error) {
    logError('GET /api/:id', error);
    return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
      status: 500,
      headers: JSON_HEADERS,
    });
  }

  return new Response(JSON.stringify({ error: 'Not found' }), {
    status: 404,
    headers: JSON_HEADERS,
  });
});

// Create paste (form)
app.post('/save', async (req) => {
  const headers = new Headers(HTML_HEADERS);

  let form: FormData;
  try {
    form = await req.formData();
  } catch (error) {
    logError('POST /save (formData)', error);
    return new Response('Bad Request', { status: 400 });
  }

  const customUrl = (form.get('url') as string) ?? '';
  const paste = (form.get('paste') as string) ?? '';
  const password = normalizePassword(form.get('password'));
  if (paste.length === 0) {
    return new Response(
      homePage({
        paste,
        url: customUrl,
        errors: { url: 'Paste content required', password: '' },
      }),
      { status: 422, headers },
    );
  }

  if (customUrl.length > MAX_CUSTOM_URL_LENGTH) {
    return new Response(
      homePage({
        paste,
        url: customUrl,
        errors: {
          url: `Custom URL cannot exceed ${MAX_CUSTOM_URL_LENGTH} characters`,
          password: '',
        },
      }),
      { status: 422, headers },
    );
  }

  const slug = createSlug(customUrl);
  const ttl = parseTtl((form.get('ttl') as string) ?? '');

  if (ttl === null) {
    return new Response(
      homePage({
        paste,
        url: customUrl,
        errors: { url: 'Invalid expiry value', password: '' },
      }),
      { status: 422, headers },
    );
  }

  if (paste.length > MAX_PASTE_SIZE) {
    return new Response(
      homePage({
        paste,
        url: customUrl,
        errors: {
          url: `Paste exceeds maximum length of ${MAX_PASTE_SIZE} characters`,
          password: '',
        },
      }),
      { status: 422, headers },
    );
  }

  if (
    password !== undefined &&
    (password.length < MIN_PASSWORD_LENGTH ||
      password.length > MAX_PASSWORD_LENGTH)
  ) {
    return new Response(
      homePage({
        paste,
        url: customUrl,
        errors: {
          url: '',
          password:
            `Password must be ${MIN_PASSWORD_LENGTH}-${MAX_PASSWORD_LENGTH} characters`,
        },
      }),
      { status: 422, headers },
    );
  }

  let editCode: string | undefined = form.get('editcode') as string;
  if (typeof editCode === 'string') {
    editCode = editCode.trim() || undefined;
  }

  try {
    if (slug.length > 0) {
      const res = await storage.get(slug);

      if (RESERVED_SLUGS.has(slug) || res.value !== null) {
        return new Response(
          homePage({
            paste,
            url: customUrl,
            errors: { url: `URL unavailable: ${customUrl}`, password: '' },
          }),
          { status: 422, headers },
        );
      }

      await storage.set(slug, paste, editCode, ttl, password);
      headers.set('location', '/' + slug.trim());
      return new Response('', { status: 302, headers });
    }

    let id = '';
    let exists = true;

    for (; exists;) {
      id = generateId();
      exists = await storage.get(id).then((r) => r.value !== null);
    }

    await storage.set(id, paste, editCode, ttl, password);
    headers.set('location', '/' + id.trim());
    return new Response('', { status: 302, headers });
  } catch (error) {
    logError('POST /save', error);
    return new Response('Internal Server Error', { status: 500 });
  }
});

// API: Create paste (JSON)
app.post('/api/save', async (req) => {
  try {
    const body = await req.json();
    const paste = (body.paste as string) ?? '';
    const customUrl = (body.url as string) ?? '';
    const editCode = (body.editCode as string) ?? undefined;
    const password = normalizePassword(body.password);
    const ttl = parseTtl(body.ttl);

    if (customUrl.length > MAX_CUSTOM_URL_LENGTH) {
      return new Response(
        JSON.stringify({
          error: `Custom URL cannot exceed ${MAX_CUSTOM_URL_LENGTH} characters`,
        }),
        {
          status: 422,
          headers: JSON_HEADERS,
        },
      );
    }

    if (ttl === null) {
      return new Response(JSON.stringify({ error: 'Invalid expiry value' }), {
        status: 422,
        headers: JSON_HEADERS,
      });
    }

    const slug = createSlug(customUrl);
    if (paste.length === 0) {
      return new Response(JSON.stringify({ error: 'Paste content required' }), {
        status: 400,
        headers: JSON_HEADERS,
      });
    }

    if (paste.length > MAX_PASTE_SIZE) {
      return new Response(
        JSON.stringify({ error: `Paste exceeds ${MAX_PASTE_SIZE} characters` }),
        {
          status: 422,
          headers: JSON_HEADERS,
        },
      );
    }

    if (
      password !== undefined &&
      (password.length < MIN_PASSWORD_LENGTH ||
        password.length > MAX_PASSWORD_LENGTH)
    ) {
      return new Response(
        JSON.stringify({
          error:
            `Password must be ${MIN_PASSWORD_LENGTH}-${MAX_PASSWORD_LENGTH} characters`,
        }),
        {
          status: 422,
          headers: JSON_HEADERS,
        },
      );
    }

    if (slug.length > 0) {
      const res = await storage.get(slug);
      if (RESERVED_SLUGS.has(slug) || res.value !== null) {
        return new Response(
          JSON.stringify({ error: `URL unavailable: ${customUrl}` }),
          {
            status: 422,
            headers: JSON_HEADERS,
          },
        );
      }

      await storage.set(slug, paste, editCode, ttl, password);
      return new Response(
        JSON.stringify({
          id: slug,
          url: '/' + slug,
          hasPassword: Boolean(password),
        }),
        {
          status: 201,
          headers: JSON_HEADERS,
        },
      );
    }

    let id = '';
    let exists = true;
    for (; exists;) {
      id = generateId();
      exists = await storage.get(id).then((r) => r.value !== null);
    }

    await storage.set(id, paste, editCode, ttl, password);
    return new Response(
      JSON.stringify({
        id,
        url: '/' + id,
        hasPassword: Boolean(password),
      }),
      {
        status: 201,
        headers: JSON_HEADERS,
      },
    );
  } catch (error) {
    logError('POST /api/save', error);
    return new Response(JSON.stringify({ error: 'Bad request' }), {
      status: 400,
      headers: JSON_HEADERS,
    });
  }
});

app.post('/:id/unlock', async (req, params) => {
  const id = params.id as string ?? '';
  const headers = new Headers(HTML_HEADERS);

  let form: FormData;
  try {
    form = await req.formData();
  } catch (error) {
    logError('POST /:id/unlock (formData)', error);
    return new Response('Bad Request', { status: 400 });
  }

  const password = normalizePassword(form.get('password'));
  const next = sanitizeNextPath(id, (form.get('next') as string) ?? undefined);

  if (!password) {
    return new Response(
      passwordPage({ id, next, error: 'Password required' }),
      {
        status: 401,
        headers: HTML_HEADERS,
      },
    );
  }

  try {
    const res = await storage.get(id);
    if (res.value === null) {
      return new Response(errorPage(), { status: 404, headers: HTML_HEADERS });
    }

    if (!res.value.passwordHash) {
      headers.set('location', next);
      return new Response('', { status: 302, headers });
    }

    const valid = await verifyPassword(password, res.value.passwordHash);
    if (!valid) {
      return new Response(
        passwordPage({ id, next, error: 'Invalid password' }),
        {
          status: 401,
          headers: HTML_HEADERS,
        },
      );
    }

    headers.set('set-cookie', buildPasswordCookie(req, id, password));
    headers.set('location', next);
    return new Response('', { status: 302, headers });
  } catch (error) {
    logError('POST /:id/unlock', error);
    return new Response('Internal Server Error', { status: 500 });
  }
});

// Update paste
app.post('/:id/save', async (req, params) => {
  const id = params.id as string ?? '';
  const headers = new Headers(HTML_HEADERS);

  if (id.trim().length === 0) {
    headers.set('location', '/');
    return new Response('', { status: 302, headers });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch (error) {
    logError('POST /:id/save (formData)', error);
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

  try {
    const res = await storage.get(id);
    if (res.value === null) {
      return new Response(errorPage(), { status: 404, headers });
    }

    const access = await hasPastePasswordAccess(
      req,
      id,
      res.value.passwordHash,
    );
    if (!access.ok) return lockedPage(id, `/${id}/edit`);
    if (access.bootstrap) return access.bootstrap;

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
  } catch (error) {
    logError('POST /:id/save', error);
    return new Response('Internal Server Error', { status: 500 });
  }
});

// Delete paste
app.post('/:id/delete', async (req, params) => {
  const id = params.id as string ?? '';
  const headers = new Headers(HTML_HEADERS);

  if (id.trim().length === 0) {
    headers.set('location', '/');
    return new Response('', { status: 302, headers });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch (error) {
    logError('POST /:id/delete (formData)', error);
    return new Response('Bad Request', { status: 400 });
  }

  let editCode: string | undefined = form.get('editcode') as string;
  if (typeof editCode === 'string') {
    editCode = editCode.trim() || undefined;
  }

  try {
    const res = await storage.get(id);
    if (res.value === null) {
      return new Response(errorPage(), { status: 404, headers });

    const existing = res.value;
    if (!existing.editCodeHash) {
      return new Response(errorPage(), { status: 404, headers });
    }

    const access = await hasPastePasswordAccess(
      req,
      id,
      existing.passwordHash,
    );
    if (!access.ok) return lockedPage(id, `/${id}/delete`);
    if (access.bootstrap) return access.bootstrap;

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
  } catch (error) {
    logError('POST /:id/delete', error);
    return new Response('Internal Server Error', { status: 500 });
  }
});

Deno.serve({ port: Number(SERVER_PORT) }, (req, info) => {
  metrics.requests += 1;
  const url = new URL(req.url);

  // Skip rate limiting for static files
  if (!FILES.has(url.pathname)) {
    const ip = info.remoteAddr.hostname;

    if (!checkRateLimit(ip)) {
      metrics.rateLimited += 1;
      return new Response('Too Many Requests', {
        status: 429,
        headers: { 'Retry-After': '60' },
      });
    }
  }

  if (req.method === 'POST' && !checkCsrf(req)) {
    return new Response('Forbidden', { status: 403 });
  }

  return app.handler(req).catch((error) => {
    logError('app.handler', error);
    return new Response('Internal Server Error', { status: 500 });
  });
});

interface MarkedToken {
  tokens: { raw: string; text: string; type: string }[];
  depth: number;
}

function createParser() {
  const tocItems: TocItem[] = [];

  const renderer = {
    heading(this: { parser: { parseInline(tokens: MarkedToken['tokens']): string } }, { tokens, depth }: MarkedToken) {
      const text: string = this.parser.parseInline(tokens);
      const anchor = createSlug(text);
      const newItem = { level: depth, text, anchor, subitems: [] };

      tocItems.push(newItem);
      return `<h${depth} id="${anchor}"><a href="#${anchor}">${text}</a></h${depth}>`;
    },

    code({ text, lang }: { text: string; lang?: string }) {
      const language = lang && hljs.getLanguage(lang) ? lang : undefined;
      const highlighted = language
        ? hljs.highlight(text, { language }).value
        : hljs.highlightAuto(text).value;
      return `<pre><code class="hljs${
        language ? ` language-${language}` : ''
      }">${highlighted}</code></pre>`;
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
