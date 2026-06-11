import { NextResponse } from "next/server";

export const runtime = "nodejs";

// 代理下载 Vercel Blob 文件，确保同域响应，浏览器才能触发"另存为"对话框
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const url = searchParams.get("url");
  const name = searchParams.get("name") || "output.webp";

  if (!url) {
    return NextResponse.json({ error: "缺少下载地址" }, { status: 400 });
  }

  // 安全校验：只允许下载 Vercel Blob 域名的文件
  try {
    const parsed = new URL(url);
    if (!parsed.hostname.endsWith(".vercel-storage.com")) {
      return NextResponse.json({ error: "不支持的下载地址" }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: "无效的下载地址" }, { status: 400 });
  }

  const res = await fetch(url);
  if (!res.ok) {
    return NextResponse.json({ error: "下载失败" }, { status: 502 });
  }

  const buffer = await res.arrayBuffer();
  const contentType = res.headers.get("content-type") || "image/webp";

  return new NextResponse(buffer, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      // Content-Disposition: attachment 强制浏览器弹出"另存为"，不解码展示
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
      "Content-Length": String(buffer.byteLength),
      "Cache-Control": "public, max-age=3600",
    },
  });
}
