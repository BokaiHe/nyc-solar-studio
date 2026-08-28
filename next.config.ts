import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Keep framework-generated AI instruction files out of the repository.
  agentRules: false,
  serverExternalPackages: ['node:sqlite'],
};

export default nextConfig;
