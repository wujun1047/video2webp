import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@ffmpeg-installer/ffmpeg"],
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;
