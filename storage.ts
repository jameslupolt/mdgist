import lz from 'lz';

export interface Paste {
  paste: string;
  editCodeHash?: string;
  passwordHash?: string;
}

const KV_PATH = Deno.env.get('KV_PATH');
export const KV = await Deno.openKv(KV_PATH);

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function hashSecret(secret: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const saltHex = toHex(salt.buffer);
  const data = new TextEncoder().encode(saltHex + secret);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return saltHex + ':' + toHex(hash);
}

export async function hashEditCode(code: string): Promise<string> {
  return hashSecret(code);
}

export async function hashPassword(password: string): Promise<string> {
  return hashSecret(password);
}

export async function verifyEditCode(
  code: string,
  stored: string,
): Promise<boolean> {
  const [salt, expectedHash] = stored.split(':');
  const data = new TextEncoder().encode(salt + code);
  const hash = await crypto.subtle.digest('SHA-256', data);
  const actualHash = toHex(hash);

  // timing-safe comparison
  const a = new TextEncoder().encode(actualHash);
  const b = new TextEncoder().encode(expectedHash);
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a[i] ^ b[i];
  return result === 0;
}

export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const [salt, expectedHash] = stored.split(':');
  const data = new TextEncoder().encode(salt + password);
  const hash = await crypto.subtle.digest('SHA-256', data);
  const actualHash = toHex(hash);

  const a = new TextEncoder().encode(actualHash);
  const b = new TextEncoder().encode(expectedHash);
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a[i] ^ b[i];
  return result === 0;
}

export const storage = {
  async get(id: string) {
    const result = await KV.get<Paste>([id]);

    if (result.value !== null) {
      result.value.paste = lz.decompress(result.value.paste);
    }

    return result;
  },

  async set(
    id: string,
    paste: string,
    editCode?: string,
    expireIn?: number,
    password?: string,
  ) {
    const compressed = lz.compress(paste) as string;
    const entry: Paste = { paste: compressed };

    if (editCode) {
      entry.editCodeHash = await hashEditCode(editCode);
    }

    if (password) {
      entry.passwordHash = await hashPassword(password);
    }

    return await KV.set([id], entry, expireIn ? { expireIn } : undefined);
  },

  async update(id: string, paste: string, editCodeHash?: string) {
    // Save current version to history before overwriting
    const current = await KV.get<Paste>([id]);
    if (current.value) {
      await KV.set([id, 'history', Date.now()], current.value);
    }

    const compressed = lz.compress(paste) as string;
    const entry: Paste = { paste: compressed };

    if (editCodeHash) {
      entry.editCodeHash = editCodeHash;
    }

    if (current.value?.passwordHash) {
      entry.passwordHash = current.value.passwordHash;
    }

    return await KV.set([id], entry);
  },

  async delete(id: string) {
    return await KV.delete([id]);
  },

  async getHistory(id: string) {
    const versions: { timestamp: number }[] = [];
    for await (const entry of KV.list({ prefix: [id, 'history'] })) {
      versions.push({ timestamp: entry.key[2] as number });
    }
    return versions.sort((a, b) => b.timestamp - a.timestamp);
  },

  async getVersion(id: string, timestamp: number) {
    const result = await KV.get<Paste>([id, 'history', timestamp]);
    if (result.value !== null) {
      result.value.paste = lz.decompress(result.value.paste);
    }
    return result;
  },
};
