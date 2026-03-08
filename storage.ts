import lz from 'lz';

export interface Paste {
  paste: string;
  editCodeHash?: string;
}

export const KV = await Deno.openKv();

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function hashEditCode(code: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const saltHex = toHex(salt.buffer);
  const data = new TextEncoder().encode(saltHex + code);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return saltHex + ':' + toHex(hash);
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

export const storage = {
  async get(id: string) {
    const result = await KV.get<Paste>([id]);

    if (result.value !== null) {
      result.value.paste = lz.decompress(result.value.paste);
    }

    return result;
  },

  async set(id: string, paste: string, editCode?: string) {
    const compressed = lz.compress(paste) as string;
    const entry: Paste = { paste: compressed };

    if (editCode) {
      entry.editCodeHash = await hashEditCode(editCode);
    }

    return await KV.set([id], entry);
  },

  async update(id: string, paste: string, editCodeHash?: string) {
    const compressed = lz.compress(paste) as string;
    const entry: Paste = { paste: compressed };

    if (editCodeHash) {
      entry.editCodeHash = editCodeHash;
    }

    return await KV.set([id], entry);
  },

  async delete(id: string) {
    return await KV.delete([id]);
  },
};
