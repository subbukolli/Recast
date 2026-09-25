import { decompressFrames, parseGIF, type ParsedFrame } from "gifuct-js";
import { GIFEncoder, applyPalette, quantize } from "gifenc";
import { RecastError } from "@/lib/faceswap/detect";
import { targetSize, type Quality } from "@/lib/faceswap/geometry";

export const MAX_GIF_SECONDS = 8;
export const MAX_GIF_FRAMES = 48;

export type GifClip = {
  width: number;
  height: number;
  frames: HTMLCanvasElement[];
  delays: number[];
  duration: number;
  truncated: boolean;
};

export function gifSide(quality: Quality) {
  return quality === "sharp" ? 640 : 480;
}

export function frameIndexAt(delays: readonly number[], timeMs: number): number {
  let elapsed = 0;
  for (let i = 0; i < delays.length; i++) {
    const delay = delays[i] ?? 100;
    if (timeMs < elapsed + delay) return i;
    elapsed += delay;
  }
  return Math.max(0, delays.length - 1);
}

export function sliceGif(delays: readonly number[], startSec: number) {
  const startMs = Math.max(0, startSec) * 1000;
  let elapsed = 0;
  let startIndex = 0;
  for (let i = 0; i < delays.length; i++) {
    const delay = delays[i] ?? 100;
    if (elapsed + delay > startMs) {
      startIndex = i;
      break;
    }
    elapsed += delay;
    startIndex = i;
  }
  const picked: number[] = [];
  let acc = 0;
  for (let i = startIndex; i < delays.length; i++) {
    if (picked.length >= MAX_GIF_FRAMES || acc >= MAX_GIF_SECONDS * 1000) break;
    const delay = Math.max(20, delays[i] ?? 100);
    picked.push(delay);
    acc += delay;
  }
  if (!picked.length && delays.length) picked.push(Math.max(20, delays[startIndex] ?? 100));
  return { startIndex, delays: picked, span: acc / 1000 };
}

function delayMs(centiseconds: number) {
  return Math.max(2, centiseconds || 10) * 10;
}

export async function decodeGif(file: Blob): Promise<GifClip> {
  let parsed: ReturnType<typeof parseGIF>;
  let raw: ParsedFrame[];
  try {
    parsed = parseGIF(await file.arrayBuffer());
    raw = decompressFrames(parsed, true);
  } catch {
    throw new RecastError("Couldn't read that GIF.");
  }
  const srcW = parsed.lsd.width;
  const srcH = parsed.lsd.height;
  if (!raw.length || srcW < 2 || srcH < 2) throw new RecastError("That GIF has no frames.");
  const { w, h } = targetSize(srcW, srcH, 720);
  const scaleX = w / srcW;
  const scaleY = h / srcH;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new RecastError("Couldn't read that GIF.");
  const patchCanvas = document.createElement("canvas");
  const patchCtx = patchCanvas.getContext("2d");
  if (!patchCtx) throw new RecastError("Couldn't read that GIF.");
  const frames: HTMLCanvasElement[] = [];
  const delays: number[] = [];
  let prevDisposal = 0;
  let saved: ImageData | null = null;
  let elapsed = 0;
  let truncated = false;
  for (let i = 0; i < raw.length; i++) {
    const frame = raw[i]!;
    if (prevDisposal === 3 && saved) ctx.putImageData(saved, 0, 0);
    if (frame.disposalType === 3) saved = ctx.getImageData(0, 0, w, h);
    const pw = frame.dims.width;
    const ph = frame.dims.height;
    if (pw > 0 && ph > 0 && frame.patch.length >= pw * ph * 4) {
      if (patchCanvas.width !== pw || patchCanvas.height !== ph) {
        patchCanvas.width = pw;
        patchCanvas.height = ph;
      }
      const pixels = pw * ph * 4;
      const patch =
        frame.patch.length === pixels ? frame.patch : frame.patch.subarray(0, pixels);
      patchCtx.putImageData(new ImageData(new Uint8ClampedArray(patch), pw, ph), 0, 0);
      ctx.drawImage(patchCanvas, frame.dims.left * scaleX, frame.dims.top * scaleY, pw * scaleX, ph * scaleY);
    }
    const shot = document.createElement("canvas");
    shot.width = w;
    shot.height = h;
    shot.getContext("2d")?.drawImage(canvas, 0, 0);
    frames.push(shot);
    const delay = delayMs(frame.delay);
    delays.push(delay);
    elapsed += delay;
    if (frame.disposalType === 2) {
      ctx.clearRect(frame.dims.left * scaleX, frame.dims.top * scaleY, Math.max(1, pw * scaleX), Math.max(1, ph * scaleY));
    }
    prevDisposal = frame.disposalType;
    if (frames.length >= MAX_GIF_FRAMES || elapsed >= MAX_GIF_SECONDS * 1000) {
      truncated = i < raw.length - 1;
      break;
    }
    if (i % 6 === 5) await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return { width: w, height: h, frames, delays, duration: elapsed / 1000, truncated };
}

function samplePixels(frames: Uint8ClampedArray[]) {
  const picks =
    frames.length <= 3
      ? frames
      : [frames[0]!, frames[Math.floor(frames.length / 2)]!, frames[frames.length - 1]!];
  const parts: Uint8Array[] = [];
  let total = 0;
  for (const data of picks) {
    const pixels = data.length / 4;
    const step = Math.max(1, Math.floor(pixels / 10000));
    const out = new Uint8Array(Math.ceil(pixels / step) * 4);
    let offset = 0;
    for (let i = 0; i < data.length; i += step * 4) {
      out[offset++] = data[i] ?? 0;
      out[offset++] = data[i + 1] ?? 0;
      out[offset++] = data[i + 2] ?? 0;
      out[offset++] = 255;
    }
    parts.push(out.subarray(0, offset));
    total += offset;
  }
  const sample = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    sample.set(part, offset);
    offset += part.length;
  }
  return sample;
}

export function encodeGif(frames: Uint8ClampedArray[], width: number, height: number, delays: number[]) {
  if (!frames.length) throw new RecastError("That GIF has no frames.");
  const palette = quantize(samplePixels(frames), 256);
  const gif = GIFEncoder();
  for (let i = 0; i < frames.length; i++) {
    const index = applyPalette(frames[i]!, palette);
    gif.writeFrame(index, width, height, {
      delay: delays[i] ?? 100,
      ...(i === 0 ? { palette, repeat: 0 } : {}),
    });
  }
  gif.finish();
  const bytes = gif.bytes();
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new Blob([copy], { type: "image/gif" });
}
