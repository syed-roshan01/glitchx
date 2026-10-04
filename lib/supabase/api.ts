import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createServerSupabaseClient } from './server';
import { createAdminClient } from './admin';
import type { Profile, Role } from '@/types';

export { friendlyError } from '@/lib/utils/errors';

export interface AuthContext {
  userId: string;
  profile: Profile;
  /** service-role client for performing authorized operations */
  admin: SupabaseClient;
}

/**
 * Authenticates the caller (via cookie session) and authorizes the
 * role. Returns a 401/403 NextResponse on failure — route handlers
 * simply `return auth.response`.
 */
export async function requireAuth(
  allowedRoles?: Role[]
): Promise<{ ctx: AuthContext | null; response: NextResponse | null }> {
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

export function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

