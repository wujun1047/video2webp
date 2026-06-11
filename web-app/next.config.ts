import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@ffmpeg-installer/ffmpeg"],
  // Vercel 的 output file tracing 不会自动追踪 @ffmpeg-installer 的动态二进制依赖，
  // 需要显式声明以确保 ffmpeg 可执行文件被包含在部署包中。
  outputFileTracingIncludes: {
    "**/*": ["./node_modules/@ffmpeg-installer/**/ffmpeg*"],
  },
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;
