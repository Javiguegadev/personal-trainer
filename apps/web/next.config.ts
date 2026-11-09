import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Workspace packages ship TypeScript source.
  transpilePackages: ['@pt/contracts', '@pt/core', '@pt/api-client', '@pt/ui', '@pt/i18n'],
};

export default nextConfig;
