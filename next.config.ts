import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ['react-is', '@sanity/ui', 'sanity'],
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      'react-is': require.resolve('react-is'),
    }
    return config
  }
};

export default nextConfig;
