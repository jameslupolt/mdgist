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

async function postForm(
  url: string,
  form: URLSearchParams,
  cookie?: string,
): Promise<Response> {
  const headers: Record<string, string> = {
    'content-type': 'application/x-www-form-urlencoded',
  };
  if (cookie) headers.cookie = cookie;
  return await fetch(url, {
    method: 'POST',
    headers,
    body: form.toString(),
    redirect: 'manual',
  });
}

Deno.test('integration: password protection, edit flow, reserved slugs, monitoring', async () => {
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

    const reserved = [
      'guide',
      'api',
      'raw',
      'edit',
      'delete',
      'history',
      'save',
    ];
    for (const slug of reserved) {
      const reservedCreate = await fetch(`${baseUrl}/api/save`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ paste: 'reserved', url: slug }),
      });
      assertEquals(reservedCreate.status, 422);
      await reservedCreate.text();
    }

    const publicCreate = await fetch(`${baseUrl}/api/save`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ paste: '# Public Paste\n\nHello world.' }),
    });
    assertEquals(publicCreate.status, 201);
    const publicBody = await publicCreate.json();
    assert(typeof publicBody.id === 'string');
    assertEquals(publicBody.url, `/${publicBody.id}`);
    assertEquals(publicBody.hasPassword, false);

    const protectedCreate = await fetch(`${baseUrl}/api/save`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        url: 'pwcase',
        paste: '# Protected\n\nSensitive.',
        editCode: 'edit123',
        password: 'secret123',
      }),
    });
    assertEquals(protectedCreate.status, 201);
    const protectedBody = await protectedCreate.json();
    assertEquals(protectedBody.id, 'pwcase');
    assertEquals(protectedBody.hasPassword, true);

    const protectedApiNoPass = await fetch(`${baseUrl}/api/pwcase`);
    assertEquals(protectedApiNoPass.status, 401);
    await protectedApiNoPass.text();

    const protectedApiWithPass = await fetch(`${baseUrl}/api/pwcase`, {
      headers: { 'x-paste-password': 'secret123' },
    });
    assertEquals(protectedApiWithPass.status, 200);
    const protectedApiWithPassBody = await protectedApiWithPass.json();
    assertEquals(protectedApiWithPassBody.hasPassword, true);
    assertMatch(protectedApiWithPassBody.paste, /Sensitive/);

    const protectedViewNoPass = await fetch(`${baseUrl}/pwcase`);
    assertEquals(protectedViewNoPass.status, 401);
    assertStringIncludes(await protectedViewNoPass.text(), 'Password Required');

    const unlockWrong = await postForm(
      `${baseUrl}/pwcase/unlock`,
      new URLSearchParams({ password: 'wrong', next: '/pwcase' }),
    );
    assertEquals(unlockWrong.status, 401);
    assertStringIncludes(await unlockWrong.text(), 'Invalid password');

    const unlock = await postForm(
      `${baseUrl}/pwcase/unlock`,
      new URLSearchParams({ password: 'secret123', next: '/pwcase' }),
    );
    assertEquals(unlock.status, 302);
    assertEquals(unlock.headers.get('location'), '/pwcase');
    const cookie = unlock.headers.get('set-cookie') ?? '';
    assertStringIncludes(cookie, 'mdgist_pw_pwcase=');
    await unlock.text();

    const protectedViewWithCookie = await fetch(`${baseUrl}/pwcase`, {
      headers: { cookie },
    });
    assertEquals(protectedViewWithCookie.status, 200);
    await protectedViewWithCookie.text();

    const historyNoPass = await fetch(`${baseUrl}/pwcase/history`);
    assertEquals(historyNoPass.status, 401);
    await historyNoPass.text();

    const historyWithPass = await fetch(`${baseUrl}/pwcase/history`, {
      headers: { cookie },
    });
    assertEquals(historyWithPass.status, 200);
    await historyWithPass.text();

    const saveWrongEditCode = await postForm(
      `${baseUrl}/pwcase/save`,
      new URLSearchParams({ paste: 'Updated one', editcode: 'wrong' }),
      cookie,
    );
    assertEquals(saveWrongEditCode.status, 400);
    assertStringIncludes(await saveWrongEditCode.text(), 'Invalid edit code');

    const saveCorrect = await postForm(
      `${baseUrl}/pwcase/save`,
      new URLSearchParams({ paste: 'Updated two', editcode: 'edit123' }),
      cookie,
    );
    assertEquals(saveCorrect.status, 302);
    assertEquals(saveCorrect.headers.get('location'), '/pwcase');
    await saveCorrect.text();

    const updatedApi = await fetch(`${baseUrl}/api/pwcase`, {
      headers: { 'x-paste-password': 'secret123' },
    });
    assertEquals(updatedApi.status, 200);
    const updatedApiBody = await updatedApi.json();
    assertMatch(updatedApiBody.paste, /Updated two/);

    const historyAfterEdit = await fetch(`${baseUrl}/pwcase/history`, {
      headers: { cookie },
    });
    assertEquals(historyAfterEdit.status, 200);
    const historyAfterEditBody = await historyAfterEdit.text();
    assertStringIncludes(historyAfterEditBody, '/pwcase/history/');

    const deleteWrongEditCode = await postForm(
      `${baseUrl}/pwcase/delete`,
      new URLSearchParams({ editcode: 'bad' }),
      cookie,
    );
    assertEquals(deleteWrongEditCode.status, 400);
    assertStringIncludes(await deleteWrongEditCode.text(), 'Invalid edit code');

    const deleteCorrect = await postForm(
      `${baseUrl}/pwcase/delete`,
      new URLSearchParams({ editcode: 'edit123' }),
      cookie,
    );
    assertEquals(deleteCorrect.status, 302);
    assertEquals(deleteCorrect.headers.get('location'), '/');
    await deleteCorrect.text();

    const deletedApi = await fetch(`${baseUrl}/api/pwcase`, {
      headers: { 'x-paste-password': 'secret123' },
    });
    assertEquals(deletedApi.status, 404);
    await deletedApi.text();

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
