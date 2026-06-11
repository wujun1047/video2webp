// 在 npm postinstall 时下载对应平台的 Google img2webp 二进制
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const BIN = path.join(__dirname, "..", "bin", "img2webp");

// 已存在则跳过
if (fs.existsSync(BIN)) { process.exit(0); }

const VERSION = "1.5.0";
const p = process.platform;
const a = process.arch === "arm64" ? "arm64" : "x86-64";
const KEY = `${p}-${a}`;

const MAP = {
  "linux-x86-64": "linux-x86-64",
  "linux-arm64": "linux-aarch64",
  "darwin-x86-64": "mac-x86-64",
  "darwin-arm64": "mac-arm64",
};
const release = MAP[KEY];
if (!release) { console.log(`  img2webp: skipped (${KEY})`); process.exit(0); }

const url = `https://storage.googleapis.com/downloads.webmproject.org/releases/webp/libwebp-${VERSION}-${release}.tar.gz`;
const binDir = path.dirname(BIN);
fs.mkdirSync(binDir, { recursive: true });

console.log(`  img2webp: downloading (${release})...`);

try {
  // curl 下载 + tar 解压，均为系统基础工具
  execSync(
    `curl -fsSL "${url}" | tar xz -C "${binDir}" --strip-components=2 "*/bin/img2webp"`,
    { stdio: "pipe" },
  );
  fs.chmodSync(BIN, 0o755);
  console.log("  img2webp: ok");
} catch (e) {
  // 非关键错误，构建可以继续（convert 函数会主动检查）
  console.error(`  img2webp: install failed — ${e.message.trim()}`);
  try { fs.unlinkSync(BIN); } catch {}
  process.exit(0);
}
