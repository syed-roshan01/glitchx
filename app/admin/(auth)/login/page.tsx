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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const supabase = createBrowserSupabaseClient();
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        toast.error(error.message === 'Invalid login credentials'
          ? 'Wrong email or password.'
          : 'Could not sign in. Please try again.');
        return;
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
