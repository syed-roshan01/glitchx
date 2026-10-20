// ============================================================
// WhatsApp relay authentication.
//
// The relay (whatsapp-relay/, runs on the shop PC) calls the
// /api/relay/* routes with this token. Keep WHATSAPP_RELAY_TOKEN
// identical in .env.local and whatsapp-relay/.env.
// ============================================================

import { NextRequest } from 'next/server';

export function relayTokenConfigured(): boolean {
  return !!process.env.WHATSAPP_RELAY_TOKEN;
}

export function isRelayAuthorized(req: NextRequest): boolean {
  const expected = process.env.WHATSAPP_RELAY_TOKEN;
  if (!expected) return false;
  const got = req.headers.get('authorization') ?? '';
  return got === `Bearer ${expected}`;
}

/** Shared error response for unauthorized/unconfigured relay calls. */
export const RELAY_UNAUTHORIZED = { error: 'Relay not authorized' };
