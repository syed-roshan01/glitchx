'use client';

import { createContext, useContext, useState, type ReactNode } from 'react';
import type { CafeSettings, Profile } from '@/types';

/**
 * Settings + signed-in profile, provided once by the admin layout
 * (server-rendered, no client round-trip). Pages read settings from
 * here instead of fetching an API route.
 */
interface AdminContextValue {
  settings: CafeSettings;
  profile: Profile;
  /** update after the settings page saves */
  setSettings: (s: CafeSettings) => void;
}

const AdminContext = createContext<AdminContextValue | null>(null);

export function AdminProvider({
  settings: initial,
  profile,
  children,
}: {
  settings: CafeSettings;
  profile: Profile;
  children: ReactNode;
}) {
  const [settings, setSettings] = useState(initial);
  return (
    <AdminContext.Provider value={{ settings, profile, setSettings }}>{children}</AdminContext.Provider>
  );
}

export function useAdmin(): AdminContextValue {
  const ctx = useContext(AdminContext);
  if (!ctx) throw new Error('useAdmin must be used inside the admin layout');
  return ctx;
}

export function useSettings(): CafeSettings {
  return useAdmin().settings;
}
