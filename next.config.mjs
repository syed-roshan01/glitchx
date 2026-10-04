/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  experimental: {
    // Build workers use worker_threads instead of child processes.
    workerThreads: true,
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
