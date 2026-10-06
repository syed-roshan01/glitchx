import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createServerSupabaseClient } from './server';
import { createAdminClient } from './admin';
import { verifyIdentity, IDENTITY_HEADER } from '@/lib/auth/signed-identity';
import type { Profile, Role } from '@/types';

export { friendlyError } from '@/lib/utils/errors';

export interface AuthContext {
  userId: string;
  profile: Profile;
  /** service-role client for performing authorized operations */
  admin: SupabaseClient;
}

/**
 * Authenticates the caller and authorizes the role.
 *
 * Fast path: when the request passed through the middleware (which already
 * validated the session), a signed identity header is present — it is verified
 * locally with ZERO network round-trips.
 * Fallback: full getUser + profile lookup for requests that bypassed the
 * middleware.
 *
 * Returns a 401/403 NextResponse on failure — route handlers simply
 * `return auth.response`.
 */
export async function requireAuth(
  allowedRoles?: Role[]
): Promise<{ ctx: AuthContext | null; response: NextResponse | null }> {
  // ---- fast path: middleware-signed identity (no network) ----
  const claims = await verifyIdentity(headers().get(IDENTITY_HEADER));
  if (claims) {
    if (allowedRoles && !allowedRoles.includes(claims.role as Role)) {
      return {
        ctx: null,
        response: NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 }),
      };
    }
    const profile = {
      id: claims.sub,
      name: claims.name,
      email: null,
      role: claims.role,
      active: true,
      created_at: null,
    } as unknown as Profile;
    return { ctx: { userId: claims.sub, profile, admin: createAdminClient() }, response: null };
  }

  // ---- fallback: full verification ----
  const supabase = createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      ctx: null,
      response: NextResponse.json({ error: 'Not authenticated' }, { status: 401 }),
    };
  }

  const admin = createAdminClient();
  const { data: profile, error } = await admin
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single();

  if (error || !profile || !profile.active) {
    return {
      ctx: null,
      response: NextResponse.json({ error: 'Account disabled or missing' }, { status: 403 }),
    };
  }

  if (allowedRoles && !allowedRoles.includes(profile.role)) {
    return {
      ctx: null,
      response: NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 }),
    };
  }

  return { ctx: { userId: user.id, profile, admin }, response: null };
}

/** Record an admin action in the audit log (best-effort). */
export async function audit(
  admin: SupabaseClient,
  userId: string | null,
  action: string,
  entityType: string,
  entityId: string | null,
  metadata?: Record<string, unknown>
) {
  try {
    await admin.from('audit_logs').insert({
      user_id: userId,
      action,
      entity_type: entityType,
      entity_id: entityId,
      metadata: metadata ?? null,
    });
  } catch {
    // auditing must never break the main operation
  }
}

/** HTTP status for a database error: FK/unique conflicts → 409, bad ids → 404. */
export function dbErrorStatus(err: { code?: string; message?: string } | null | undefined, fallback = 400) {
  if (err?.code === '23503' || err?.code === '23505') return 409;
  if (err?.code === '22P02' || err?.code === 'PGRST116') return 404;
  return fallback;
}

/** Sanitise a free-text search term for use inside a PostgREST `.or()` filter. */
export function searchTerm(q: string | null | undefined, max = 60): string {
  return (q ?? '').replace(/[,()*%\\:"']/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

/** Parse limit/offset query params safely. */
export function pageParams(req: { nextUrl: URL }, defLimit = 20, maxLimit = 100) {
  const l = Number(req.nextUrl.searchParams.get('limit'));
  const o = Number(req.nextUrl.searchParams.get('offset'));
  const limit = Number.isFinite(l) && l > 0 ? Math.min(Math.floor(l), maxLimit) : defLimit;
  const offset = Number.isFinite(o) && o > 0 ? Math.floor(o) : 0;
  return { limit, offset };
}

export function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status: status });
}
