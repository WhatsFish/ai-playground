/** @type {import('next').NextConfig} */
const nextConfig = {
  basePath: "/chat",
  output: "standalone",
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
