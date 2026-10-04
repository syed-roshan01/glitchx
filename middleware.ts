import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { signIdentity, IDENTITY_HEADER } from '@/lib/auth/signed-identity';

/**
 * Refreshes auth cookies, guards /admin routes and mints a signed identity
 * header so downstream layouts/API routes skip their own auth round-trips.
 */
interface CachedProfile {
  role: string;
  name: string;
  active: boolean;
  exp: number;
}

/** per-instance profile cache — avoids a profiles query on every request */
const profileCache = new Map<string, CachedProfile>();
const PROFILE_TTL_MS = 60_000;

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });
  let pendingCookies: { name: string; value: string; options: CookieOptions }[] = [];

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          pendingCookies = cookiesToSet;
        },
      },
    }
  );

  // IMPORTANT: do not remove — refreshes the session token
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const isLogin = path === '/admin/login';
  const isSetup = path === '/admin/setup';

  if (!user && path.startsWith('/admin') && !isLogin && !isSetup) {
    const url = request.nextUrl.clone();
    url.pathname = '/admin/login';
    url.searchParams.set('next', path);
    return NextResponse.redirect(url);
  }

  // API calls: reject directly instead of falling through to the route handler
  if (!user && path.startsWith('/api/admin')) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  if (user && isLogin) {
    const url = request.nextUrl.clone();
    url.pathname = '/admin';
    url.search = '';
    return NextResponse.redirect(url);
  }

  // ---- mint the signed identity for downstream server code ----
  let identityToken: string | null = null;
  if (user) {
    let cached = profileCache.get(user.id);
    if (!cached || cached.exp < Date.now()) {
      // profiles are self-readable via RLS with the user-scoped client
      const { data: p } = await supabase
        .from('profiles')
        .select('role, name, active')
        .eq('id', user.id)
        .single();
      if (p) {
        cached = {
          role: p.role,
          name: p.name ?? '',
          active: p.active !== false,
          exp: Date.now() + PROFILE_TTL_MS,
        };
        profileCache.set(user.id, cached);
      }
    }
    if (cached) {
      identityToken = await signIdentity({
        sub: user.id,
        role: cached.role,
        name: cached.name,
        active: cached.active,
      });
    }
  }

  // forward request headers (incl. refreshed cookies + signed identity) and
  // apply any pending Set-Cookie headers to the browser response
  const requestHeaders = new Headers(request.headers);
  requestHeaders.delete(IDENTITY_HEADER); // never trust a client-sent token
  if (identityToken) requestHeaders.set(IDENTITY_HEADER, identityToken);

  response = NextResponse.next({ request: { headers: requestHeaders } });
  pendingCookies.forEach(({ name, value, options }) => response.cookies.set(name, value, options));

  return response;
}

export const config = {
  matcher: ['/admin/:path*', '/api/admin/:path*'],
};
