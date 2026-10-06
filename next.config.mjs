/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  experimental: {
    // Build workers use worker_threads instead of child processes.
    workerThreads: true,
    // keep visited admin pages in the client router cache so back/forth
    // navigation is instant (data still refreshes via useApi + realtime)
    staleTimes: { dynamic: 30, static: 180 },
    // Set NEXT_DISABLE_BUILD_WORKER=1 to compile in the main process
    // (useful in restricted environments that block child processes).
    ...(process.env.NEXT_DISABLE_BUILD_WORKER ? { webpackBuildWorker: false } : {}),
  },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**.supabase.co' },
      { protocol: 'https', hostname: '**.supabase.in' },
    ],
  },
};

export default nextConfig;
