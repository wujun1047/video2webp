import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";

import { MAX_INPUT_BYTES } from "@/lib/validation";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json(
      { error: "缺少 BLOB_READ_WRITE_TOKEN，请先配置 Vercel Blob" },
      { status: 500 },
    );
  }

  const body = (await request.json()) as HandleUploadBody;

  try {
    const response = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname) => {
        if (!pathname.startsWith("inputs/")) {
          throw new Error("上传路径必须位于 inputs/ 下");
        }

        return {
          allowedContentTypes: ["video/mp4", "video/quicktime"],
          maximumSizeInBytes: MAX_INPUT_BYTES,
          addRandomSuffix: true,
        };
      },
      onUploadCompleted: async () => {},
    });

    return NextResponse.json(response);
  } catch (error) {
    return NextResponse.json(
      { error: getErrorMessage(error) },
      { status: 400 },
    );
  }
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "上传失败";
}
