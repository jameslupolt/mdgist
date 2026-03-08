import {
  assert,
  assertEquals,
  assertMatch,
  assertStringIncludes,
} from 'jsr:@std/assert@^1.0.11';

const TEST_TIMEOUT_MS = 15_000;

async function waitForServer(baseUrl: string) {
  const deadline = Date.now() + TEST_TIMEOUT_MS;
  let lastError: unknown;

  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseUrl}/health`);
      if (res.ok) {
        await res.text();
        return;
      }
      await res.text();
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  throw new Error(`Server did not start in time: ${String(lastError)}`);
}

Deno.test('integration: api, private paste access, and monitoring', async () => {
  const port = 19000 + Math.floor(Math.random() * 1000);
  const baseUrl = `http://127.0.0.1:${port}`;
  const kvDir = await Deno.makeTempDir();
  const kvPath = `${kvDir}/test.kv`;

  const cmd = new Deno.Command(Deno.execPath(), {
    args: [
      'run',
      '--allow-env',
      '--allow-net',
      '--allow-read',
      '--allow-write',
      '--unstable-kv',
      '--unstable-cron',
      'main.ts',
    ],
    env: {
      MODE: 'prod',
      SERVER_PORT: String(port),
      KV_PATH: kvPath,
    },
    stdout: 'null',
    stderr: 'null',
  });

  const child = cmd.spawn();

  try {
    await waitForServer(baseUrl);

    const publicCreate = await fetch(`${baseUrl}/api/save`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ paste: '# Public Paste\n\nHello world.' }),
    });
    assertEquals(publicCreate.status, 201);
    const publicBody = await publicCreate.json();
    assert(typeof publicBody.id === 'string');
    assertEquals(publicBody.isPrivate, false);

    const privateCreate = await fetch(`${baseUrl}/api/save`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        paste: '# Private Paste\n\nTop secret.',
        private: true,
      }),
    });
    assertEquals(privateCreate.status, 201);
    const privateBody = await privateCreate.json();
    assert(typeof privateBody.id === 'string');
    assertEquals(privateBody.isPrivate, true);
    assert(typeof privateBody.viewToken === 'string');
    assert(privateBody.viewToken.length > 0);
    assertStringIncludes(privateBody.url, '?view=');

    const privateApiNoToken = await fetch(`${baseUrl}/api/${privateBody.id}`);
    assertEquals(privateApiNoToken.status, 404);
    await privateApiNoToken.text();

    const privateApiWithToken = await fetch(
      `${baseUrl}/api/${privateBody.id}?view=${
        encodeURIComponent(privateBody.viewToken)
      }`,
    );
    assertEquals(privateApiWithToken.status, 200);
    const privateGetBody = await privateApiWithToken.json();
    assertEquals(privateGetBody.isPrivate, true);
    assertMatch(privateGetBody.paste, /Top secret/);

    const privatePageNoToken = await fetch(`${baseUrl}/${privateBody.id}`);
    assertEquals(privatePageNoToken.status, 404);
    await privatePageNoToken.text();

    const privatePageWithToken = await fetch(
      `${baseUrl}/${privateBody.id}?view=${
        encodeURIComponent(privateBody.viewToken)
      }`,
    );
    assertEquals(privatePageWithToken.status, 200);
    await privatePageWithToken.text();

    const health = await fetch(`${baseUrl}/health`);
    assertEquals(health.status, 200);
    const healthJson = await health.json();
    assertEquals(healthJson.status, 'ok');

    const metrics = await fetch(`${baseUrl}/metrics`);
    assertEquals(metrics.status, 200);
    const metricsJson = await metrics.json();
    assert(typeof metricsJson.requests === 'number');
    assert(typeof metricsJson.errors === 'number');
    assert(typeof metricsJson.rateLimited === 'number');
    assert(typeof metricsJson.uptimeSeconds === 'number');
  } finally {
    try {
      child.kill('SIGTERM');
    } catch {
    }
    await child.status;
    await Deno.remove(kvDir, { recursive: true });
  }
});
