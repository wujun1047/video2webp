/**
 * WebP 动画编码器
 *
 * 策略：用浏览器原生 Canvas.toBlob('image/webp') 编码单帧为 WebP，
 * 然后纯 JS 组装 RIFF/WEBP 动画容器（无需额外 WASM 依赖）。
 *
 * WebP 动画容器结构（RIFF）：
 *   RIFF[WEBP[ANIM[ANMF(VP8X+ALPH+VP8/VP8L)]ANMF...]]
 */

/**
 * 将 ImageData 编码为单帧 WebP
 *
 * 注意：浏览器 Canvas.toBlob('image/webp') 在 lossy 模式下（quality<1）
 * 使用 VP8 编码，不支持 alpha 通道，透明像素会变黑。
 * 必须使用 lossless 模式（quality=1）以启用 VP8L，保留 alpha。
 */
export async function encodeWebpFrame(
  imgData: ImageData,
): Promise<ArrayBuffer> {
  const canvas = document.createElement('canvas');
  canvas.width = imgData.width;
  canvas.height = imgData.height;
  const ctx = canvas.getContext('2d')!;
  ctx.putImageData(imgData, 0, 0);

  const blob = await new Promise<Blob>((resolve) => {
    // quality=1 → lossless WebP (VP8L)，保留 alpha
    canvas.toBlob(
      (b) => resolve(b!),
      'image/webp',
      1,
    );
  });

  return blob.arrayBuffer();
}

/**
 * 组装动画 WebP
 *
 * @param frameBuffers 每帧的 WebP 编码数据（ArrayBuffer）
 * @param frameDurations 每帧的显示时长（毫秒）
 * @param canvasWidth 画布宽度
 * @param canvasHeight 画布高度
 * @param loop 是否循环播放
 */
export async function muxAnimatedWebP(
  frameBuffers: ArrayBuffer[],
  frameDurations: number[],
  canvasWidth: number,
  canvasHeight: number,
  loop: boolean = true,
): Promise<Blob> {
  // 1. 构建 ANIM chunk
  const animChunk = buildChunk('ANIM', buildAnimPayload(loop ? 0 : 1));

  // 2. 构建 ANMF chunks
  const anmfChunks: Uint8Array[] = [];
  for (let i = 0; i < frameBuffers.length; i++) {
    const frameData = new Uint8Array(frameBuffers[i]);
    const duration = frameDurations[i] || 100;

    anmfChunks.push(
      buildChunk('ANMF', buildAnmfPayload(
        0, 0,                    // frame_x, frame_y
        canvasWidth, canvasHeight, // frame_width, frame_height
        0, 0,                    // 水平和垂直偏移（未使用）
        duration,
        frameData,
      )),
    );
  }

  // 3. 计算总大小
  let totalSize = 12; // RIFF header
  totalSize += animChunk.length;
  for (const chunk of anmfChunks) totalSize += chunk.length;

  // 4. 构建 RIFF/WEBP
  const riff = new Uint8Array(totalSize);
  const view = new DataView(riff.buffer);
  let offset = 0;

  // RIFF header
  writeFourCC(riff, offset, 'RIFF'); offset += 4;
  view.setUint32(offset, totalSize - 8, true); offset += 4; // 剩余大小（小端序）
  writeFourCC(riff, offset, 'WEBP'); offset += 4;

  // ANIM chunk
  riff.set(animChunk, offset); offset += animChunk.length;

  // ANMF chunks
  for (const chunk of anmfChunks) {
    riff.set(chunk, offset);
    offset += chunk.length;
  }

  return new Blob([riff], { type: 'image/webp' });
}

// ---- WebP RIFF 构建工具函数 ----

function writeFourCC(buf: Uint8Array, offset: number, cc: string): void {
  for (let i = 0; i < 4; i++) {
    buf[offset + i] = cc.charCodeAt(i);
  }
}

function buildChunk(fourCC: string, payload: Uint8Array): Uint8Array {
  // 如果 payload 长度是奇数，需要添加 1 字节填充
  const padLen = payload.length % 2 === 1 ? 1 : 0;
  const totalLen = 8 + payload.length + padLen;
  const chunk = new Uint8Array(totalLen);
  const view = new DataView(chunk.buffer);

  writeFourCC(chunk, 0, fourCC);
  view.setUint32(4, payload.length, true);
  chunk.set(payload, 8);

  return chunk;
}

/** 构建 ANIM chunk 的 payload */
function buildAnimPayload(loopCount: number = 0): Uint8Array {
  const payload = new Uint8Array(6);
  const view = new DataView(payload.buffer);

  view.setUint32(0, 0xFFFFFFFF, true);  // bgcolor: 白色（不透明）
  view.setUint16(4, loopCount, true);   // loop_count: 0=无限循环

  return payload;
}

/** 构建 ANMF chunk 的 payload */
function buildAnmfPayload(
  frameX: number,
  frameY: number,
  frameWidth: number,
  frameHeight: number,
  _hOffset: number,
  _vOffset: number,
  duration: number,
  frameData: Uint8Array,
): Uint8Array {
  // ANMF header = 16 bytes
  const header = new Uint8Array(16);
  let off = 0;

  // Frame X, Y (3 bytes each, little-endian 24-bit)
  header[off++] = frameX & 0xFF;
  header[off++] = (frameX >> 8) & 0xFF;
  header[off++] = (frameX >> 16) & 0xFF;

  header[off++] = frameY & 0xFF;
  header[off++] = (frameY >> 8) & 0xFF;
  header[off++] = (frameY >> 16) & 0xFF;

  // Frame Width, Height (3 bytes each, minus 1)
  const w = frameWidth - 1;
  const h = frameHeight - 1;
  header[off++] = w & 0xFF;
  header[off++] = (w >> 8) & 0xFF;
  header[off++] = (w >> 16) & 0xFF;

  header[off++] = h & 0xFF;
  header[off++] = (h >> 8) & 0xFF;
  header[off++] = (h >> 16) & 0xFF;

  // Duration (3 bytes, milliseconds)
  header[off++] = duration & 0xFF;
  header[off++] = (duration >> 8) & 0xFF;
  header[off++] = (duration >> 16) & 0xFF;

  // 保留 + blending method + disposal method
  // 0: 不混合，不清除（默认行为）
  header[off] = 0;

  // 合并 header + frame data
  const payload = new Uint8Array(16 + frameData.length);
  payload.set(header, 0);
  payload.set(frameData, 16);

  return payload;
}

/**
 * 完整流程：将 ImageData[] 编码为动画 WebP
 *
 * @param frames 处理后的 RGBA 帧
 * @param fps 帧率
 * @param onProgress 进度回调
 */
export async function encodeAnimation(
  frames: ImageData[],
  fps: number,
  onProgress?: (current: number, total: number) => void,
): Promise<Blob> {
  const total = frames.length;
  const frameBuffers: ArrayBuffer[] = [];
  const duration = Math.round(1000 / fps);

  // 逐帧编码为 WebP（lossless 保证 alpha 不丢失）
  for (let i = 0; i < total; i++) {
    const buffer = await encodeWebpFrame(frames[i]);
    frameBuffers.push(buffer);
    onProgress?.(i + 1, total);
  }

  // 合成动画 WebP
  const width = frames[0]?.width ?? 0;
  const height = frames[0]?.height ?? 0;
  const durations = Array(total).fill(duration);

  return muxAnimatedWebP(frameBuffers, durations, width, height, true);
}
