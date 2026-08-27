import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Keep framework-generated AI instruction files out of the repository.
  agentRules: false,
};

export default nextConfig;
