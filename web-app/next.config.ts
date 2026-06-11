import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  env: {
    // 构建时写入时间戳作为版本号，部署后页面底部可见
    NEXT_PUBLIC_BUILD_TIME: new Date().toISOString(),
  },
  // 原生模块必须保留在 node_modules 中，不能被打包 bundle
  // 否则会导致 .node 原生文件和 libvips/ffmpeg 二进制找不到
  serverExternalPackages: [
    "@ffmpeg-installer/ffmpeg",
    "libwebp-static",
    "sharp",
  ],
  outputFileTracingIncludes: {
    "**/*": [
      "./node_modules/@ffmpeg-installer/**/ffmpeg*",
      "./node_modules/@img/**/*.node",
      "./node_modules/@img/**/*.so*",
      "./node_modules/sharp/**/*.node",
      "./node_modules/libwebp-static/binaries/**/*",
    ],
  },
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;
