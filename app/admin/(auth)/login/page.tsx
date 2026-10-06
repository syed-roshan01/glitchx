'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input, Field } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { Logo } from '@/components/ui/logo';

export default function LoginPage() {
  const router = useRouter();
  const toast = useToast();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setNotice(null);
    try {
      const supabase = createBrowserSupabaseClient();
      const { data: auth, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        toast.error(error.message === 'Invalid login credentials'
          ? 'Wrong email or password.'
          : 'Could not sign in. Please try again.');
        return;
      }
      // inactive accounts would be rejected by the middleware/API — explain why
      if (auth.user) {
        const { data: profile, error: pErr } = await supabase
          .from('profiles')
          .select('active')
          .eq('id', auth.user.id)
          .single();
        // PGRST116 = no profile row; any other error falls through to the
        // server-side guard rather than blocking a valid user
        if (profile?.active === false || pErr?.code === 'PGRST116') {
          await supabase.auth.signOut();
          const msg = 'Your account is not active yet — ask an admin to activate it.';
          setNotice(msg);
          toast.error(msg);
          return;
        }
      }
      // check for first-time setup
      const { data: status } = await supabase.rpc('public_setup_status');
      router.push(status?.needs_admin ? '/admin/setup' : '/admin');
      router.refresh();
    } catch {
      toast.error('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mb-4 flex justify-center">
            <Logo className="h-16 w-auto rounded-2xl shadow-glow" alt="Gaming Cafe" />
          </div>
          <h1 className="text-2xl font-extrabold tracking-tight">Gaming Cafe</h1>
          <p className="mt-1 text-sm text-muted">Staff & admin sign in</p>
        </div>

        <form onSubmit={handleSubmit} className="glass space-y-4 rounded-2xl p-6 shadow-card">
          <Field label="Email" required>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@cafe.com"
              autoComplete="email"
              required
              autoFocus
            />
          </Field>
          <Field label="Password" required>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
              required
            />
          </Field>
          {notice && (
            <p className="rounded-xl border border-warning/40 bg-warning/10 px-3 py-2 text-sm font-semibold text-warning" role="alert">
              {notice}
            </p>
          )}
          <Button type="submit" loading={loading} className="w-full" size="lg">
            Sign In
          </Button>
        </form>

        <p className="mt-6 text-center text-xs text-muted">
          First time here?{' '}
          <Link href="/admin/setup" className="font-semibold text-secondary hover:underline">
            Run the setup wizard
          </Link>
        </p>
      </div>
    </div>
  );
}
