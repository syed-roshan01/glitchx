/**
 * Signed identity tokens — the performance fast path for admin auth.
 *
 * The middleware authenticates each request once (supabase.auth.getUser) and
 * mints a short-lived HMAC-signed token carrying {sub, role, name, active}.
 * Route handlers and server layouts verify the signature LOCALLY (Web Crypto,
 * available in both the Edge and Node runtimes) — zero network round-trips.
 *
 * Security model:
 *  - Signed with a server-only secret (derived from SUPABASE_SERVICE_ROLE_KEY,
 *    which is never exposed to clients), so a client cannot forge a token even
 *    though the header name is public.
 *  - The middleware always OVERWRITES the header on matched paths, and
 *    verification fails closed for anything unsigned, expired or inactive.
 *  - requireAuth() falls back to the full getUser+profile path whenever the
 *    token is absent (e.g. a request that bypassed the middleware matcher).
 */

const enc = new TextEncoder();
const dec = new TextDecoder();

export const IDENTITY_HEADER = 'x-dsh-identity';

/** lifetime of a minted token (only needs to cover a single request) */
const TOKEN_TTL_SECONDS = 120;

function secretString(): string {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    // fail closed: verification returns null and requireAuth uses the full path
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set');
  }
  return key;
}

function b64urlEncode(str: string): string {
  const bytes = enc.encode(str);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(str: string): string {
  let s = str.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return dec.decode(bytes);
}

async function hmac(data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secretString()),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data));
  let bin = '';
  const bytes = new Uint8Array(sig);
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export interface IdentityClaims {
  sub: string;
  role: string;
  name: string;
  active: boolean;
  exp: number;
}

export async function signIdentity(claims: {
  sub: string;
  role: string;
  name: string;
  active: boolean;
}): Promise<string> {
  const payload: IdentityClaims = { ...claims, exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS };
  const body = b64urlEncode(JSON.stringify(payload));
  return `${body}.${await hmac(body)}`;
}

export async function verifyIdentity(token: string | null | undefined): Promise<IdentityClaims | null> {
  if (!token) return null;
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  try {
    if (!constantTimeEqual(sig, await hmac(body))) return null;
    const claims = JSON.parse(b64urlDecode(body)) as IdentityClaims;
    if (!claims?.sub || typeof claims.exp !== 'number' || claims.active === false) return null;
    if (claims.exp < Math.floor(Date.now() / 1000)) return null;
    return claims;
  } catch {
    return null;
  }
}
