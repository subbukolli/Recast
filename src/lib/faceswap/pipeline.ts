import { RecastError, detectStill, detectVideo, fitFace, preparePhoto, type PhotoMesh } from "@/lib/faceswap/detect";
import { openSink, readPcm } from "@/lib/faceswap/encode";
import { encodeGif, gifSide, sliceGif, type GifClip } from "@/lib/faceswap/gif";
import { QUALITY, clipSpan, targetSize, type Pt, type Quality } from "@/lib/faceswap/geometry";
import { paintFace } from "@/lib/faceswap/warp";

export { RecastError } from "@/lib/faceswap/detect";
export { clipSpan, MAX_SECONDS } from "@/lib/faceswap/geometry";

let photoCache: { key: string; mesh: PhotoMesh } | null = null;
let workCanvas: HTMLCanvasElement | null = null;
let warpCanvas: HTMLCanvasElement | null = null;

function work(width: number, height: number) {
  if (!workCanvas) workCanvas = document.createElement("canvas");
  if (workCanvas.width !== width || workCanvas.height !== height) {
    workCanvas.width = width;
    workCanvas.height = height;
  }
  const ctx = workCanvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new RecastError("Couldn't draw that frame.");
  return { canvas: workCanvas, ctx };
}

function warpLayer() {
  if (!warpCanvas) warpCanvas = document.createElement("canvas");
  return warpCanvas;
}

export async function fileToCanvas(file: Blob): Promise<HTMLCanvasElement> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    bitmap = await createImageBitmap(file);
  }
  const max = 1400;
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(2, Math.round(bitmap.width * scale));
  canvas.height = Math.max(2, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new RecastError("Couldn't read that photo.");
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas;
}

export function seekTo(video: HTMLVideoElement, time: number): Promise<void> {
  const end = Number.isFinite(video.duration) ? Math.max(0, video.duration - 0.04) : time;
  const target = Math.min(Math.max(0, time), end);
  if (video.readyState >= 2 && Math.abs(video.currentTime - target) < 0.03) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      cleanup();
      resolve();
    }, 2500);
    const onSeeked = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new RecastError("Couldn't read a frame from that clip."));
    };
    const cleanup = () => {
      window.clearTimeout(timer);
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("error", onError);
    };
    video.addEventListener("seeked", onSeeked);
    video.addEventListener("error", onError);
    try {
      video.currentTime = target;
    } catch (error) {
      cleanup();
      reject(error instanceof Error ? error : new RecastError("Couldn't read a frame from that clip."));
    }
  });
}

async function meshFor(photo: HTMLCanvasElement, flip: boolean, token: string) {
  const key = `${token}:${flip ? 1 : 0}:${photo.width}x${photo.height}`;
  if (photoCache?.key === key) return photoCache.mesh;
  const mesh = await preparePhoto(photo, flip);
  photoCache = { key, mesh };
  return mesh;
}

function throwIfAborted(signal: AbortSignal) {
  if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
}

type PaintState = { previous: Pt[] | null; missed: number; mean: [number, number, number] | null };

function composite(opts: {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  mesh: PhotoMesh;
  landmarks: Awaited<ReturnType<typeof detectStill>>;
  follow: number;
  lighting: boolean;
  state: PaintState;
  hold: boolean;
}) {
  const frame = opts.ctx.getImageData(0, 0, opts.width, opts.height);
  const { fit, smoothed } = fitFace(
    opts.mesh,
    opts.landmarks,
    opts.width,
    opts.height,
    opts.follow,
    frame,
    opts.hold ? opts.state.previous : null,
  );
  let dst = fit?.dst ?? null;
  let mean = fit?.mean ?? opts.state.mean;
  if (!dst && opts.state.previous && opts.state.missed < 4) {
    dst = opts.state.previous;
    opts.state.missed += 1;
  } else if (dst && smoothed) {
    opts.state.previous = smoothed;
    opts.state.missed = 0;
    if (fit?.mean) {
      opts.state.mean = fit.mean;
      mean = fit.mean;
    }
  } else {
    opts.state.missed += 1;
  }
  if (!dst) return false;
  paintFace({
    frame: opts.ctx,
    frameW: opts.width,
    frameH: opts.height,
    photo: opts.mesh.canvas,
    src: opts.mesh.src,
    dst,
    indices: opts.mesh.indices,
    triangles: opts.mesh.triangles,
    srcMean: opts.mesh.mean,
    dstMean: mean,
    lighting: opts.lighting,
    warp: warpLayer(),
  });
  return true;
}

export async function renderStill(opts: {
  video: HTMLVideoElement;
  photo: HTMLCanvasElement;
  photoToken: string;
  flip: boolean;
  follow: number;
  lighting: boolean;
  quality: Quality;
  start: number;
  output: HTMLCanvasElement;
  signal: AbortSignal;
}): Promise<"face" | "noface"> {
  throwIfAborted(opts.signal);
  if (!opts.video.videoWidth) throw new RecastError("That clip isn't ready yet.");
  const mesh = await meshFor(opts.photo, opts.flip, opts.photoToken);
  throwIfAborted(opts.signal);
  opts.video.pause();
  await seekTo(opts.video, opts.start);
  throwIfAborted(opts.signal);
  const { w, h } = targetSize(opts.video.videoWidth, opts.video.videoHeight, QUALITY[opts.quality].longSide);
  const { canvas, ctx } = work(w, h);
  ctx.drawImage(opts.video, 0, 0, w, h);
  const landmarks = await detectStill(canvas);
  const painted = composite({
    ctx,
    width: w,
    height: h,
    mesh,
    landmarks,
    follow: opts.follow,
    lighting: opts.lighting,
    state: { previous: null, missed: 0, mean: null },
    hold: false,
  });
  opts.output.width = w;
  opts.output.height = h;
  const out = opts.output.getContext("2d");
  if (!out) throw new RecastError("Couldn't show the preview.");
  out.drawImage(canvas, 0, 0);
  return painted ? "face" : "noface";
}

export async function recastClip(opts: {
  file: File;
  video: HTMLVideoElement;
  photo: HTMLCanvasElement;
  photoToken: string;
  flip: boolean;
  follow: number;
  lighting: boolean;
  quality: Quality;
  start: number;
  signal: AbortSignal;
  onProgress: (info: { done: number; total: number; label: string }) => void;
}): Promise<{ blob: Blob; ext: "mp4" | "webm" }> {
  throwIfAborted(opts.signal);
  if (!opts.video.videoWidth) throw new RecastError("That clip isn't ready yet.");
  const spec = QUALITY[opts.quality];
  const span = clipSpan(opts.video.duration, opts.start);
  const total = Math.max(1, Math.round(span * spec.fps));
  opts.onProgress({ done: 0, total, label: "Reading your photo" });
  const mesh = await meshFor(opts.photo, opts.flip, opts.photoToken);
  throwIfAborted(opts.signal);
  opts.onProgress({ done: 0, total, label: "Checking audio" });
  const pcm = await readPcm(opts.file, opts.start, span, opts.video.duration);
  throwIfAborted(opts.signal);
  const { w, h } = targetSize(opts.video.videoWidth, opts.video.videoHeight, spec.longSide);
  const sink = await openSink({
    width: w,
    height: h,
    fps: spec.fps,
    pcm,
    audioEl: opts.video,
    audioStart: opts.start,
  });
  const { canvas, ctx } = work(w, h);
  const state: PaintState = { previous: null, missed: 0, mean: null };
  opts.video.pause();
  opts.video.muted = true;
  let faced = 0;
  const step = 1 / spec.fps;
  const end = opts.start + span;

  const take = async (index: number) => {
    ctx.drawImage(opts.video, 0, 0, w, h);
    const landmarks = await detectVideo(canvas);
    if (
      composite({
        ctx,
        width: w,
        height: h,
        mesh,
        landmarks,
        follow: opts.follow,
        lighting: opts.lighting,
        state,
        hold: true,
      })
    ) {
      faced += 1;
    }
    await sink.push(canvas, index);
    if (index % 2 === 0 || index === total - 1) {
      opts.onProgress({ done: index + 1, total, label: "Recasting" });
    }
  };

  if ("requestVideoFrameCallback" in opts.video) {
    await seekTo(opts.video, opts.start);
    await new Promise<void>((resolve, reject) => {
      let index = 0;
      let lastMedia = -1;
      let stuck = 0;
      let hops = 0;
      const fail = (error: unknown) => {
        opts.video.pause();
        reject(error);
      };
      const finish = () => {
        opts.video.pause();
        resolve();
      };
      const pump = () => {
        if (hops++ > total * 12) {
          finish();
          return;
        }
        opts.video.requestVideoFrameCallback((_now, meta) => {
          void (async () => {
            try {
              throwIfAborted(opts.signal);
              opts.video.pause();
              const mediaTime = meta.mediaTime;
              if (index >= total || mediaTime >= end - 0.015 || opts.video.ended) {
                if (index < total && mediaTime < end && !opts.video.ended) {
                  ctx.drawImage(opts.video, 0, 0, w, h);
                }
                finish();
                return;
              }
              const target = opts.start + index * step;
              if (mediaTime + step * 0.45 < target || mediaTime <= lastMedia + 0.0005) {
                stuck = mediaTime <= lastMedia + 0.0005 ? stuck + 1 : 0;
                if (stuck > 2) {
                  opts.video.currentTime = Math.min(end - 0.02, mediaTime + step);
                  stuck = 0;
                }
                await opts.video.play();
                pump();
                return;
              }
              stuck = 0;
              lastMedia = mediaTime;
              await take(index);
              index += 1;
              if (index >= total) {
                finish();
                return;
              }
              await opts.video.play();
              pump();
            } catch (error) {
              fail(error);
            }
          })();
        });
      };
      void opts.video.play().then(pump).catch(fail);
    });
  } else {
    for (let i = 0; i < total; i++) {
      throwIfAborted(opts.signal);
      await seekTo(opts.video, opts.start + i * step);
      await take(i);
    }
  }

  if (faced < Math.min(3, total)) {
    throw new RecastError("No face in that part of the clip. Move the start time to a clear face.");
  }
  opts.onProgress({ done: total, total, label: "Wrapping the file" });
  return sink.finish();
}

export async function renderGifStill(opts: {
  frame: HTMLCanvasElement;
  photo: HTMLCanvasElement;
  photoToken: string;
  flip: boolean;
  follow: number;
  lighting: boolean;
  quality: Quality;
  output: HTMLCanvasElement;
  signal: AbortSignal;
}): Promise<"face" | "noface"> {
  throwIfAborted(opts.signal);
  const mesh = await meshFor(opts.photo, opts.flip, opts.photoToken);
  throwIfAborted(opts.signal);
  const { w, h } = targetSize(opts.frame.width, opts.frame.height, gifSide(opts.quality));
  const { canvas, ctx } = work(w, h);
  ctx.drawImage(opts.frame, 0, 0, w, h);
  const landmarks = await detectStill(canvas);
  const painted = composite({
    ctx,
    width: w,
    height: h,
    mesh,
    landmarks,
    follow: opts.follow,
    lighting: opts.lighting,
    state: { previous: null, missed: 0, mean: null },
    hold: false,
  });
  opts.output.width = w;
  opts.output.height = h;
  const out = opts.output.getContext("2d");
  if (!out) throw new RecastError("Couldn't show the preview.");
  out.drawImage(canvas, 0, 0);
  return painted ? "face" : "noface";
}

export async function recastGif(opts: {
  gif: GifClip;
  photo: HTMLCanvasElement;
  photoToken: string;
  flip: boolean;
  follow: number;
  lighting: boolean;
  quality: Quality;
  start: number;
  signal: AbortSignal;
  onProgress: (info: { done: number; total: number; label: string }) => void;
}): Promise<Blob> {
  throwIfAborted(opts.signal);
  const slice = sliceGif(opts.gif.delays, opts.start);
  const total = slice.delays.length;
  if (!total) throw new RecastError("That GIF has no frames.");
  opts.onProgress({ done: 0, total, label: "Reading your photo" });
  const mesh = await meshFor(opts.photo, opts.flip, opts.photoToken);
  throwIfAborted(opts.signal);
  const { w, h } = targetSize(opts.gif.width, opts.gif.height, gifSide(opts.quality));
  const { canvas, ctx } = work(w, h);
  const state: PaintState = { previous: null, missed: 0, mean: null };
  const rgba: Uint8ClampedArray[] = [];
  let faced = 0;
  for (let i = 0; i < total; i++) {
    throwIfAborted(opts.signal);
    const frame = opts.gif.frames[slice.startIndex + i];
    if (!frame) break;
    ctx.drawImage(frame, 0, 0, w, h);
    const landmarks = await detectVideo(canvas);
    if (
      composite({
        ctx,
        width: w,
        height: h,
        mesh,
        landmarks,
        follow: opts.follow,
        lighting: opts.lighting,
        state,
        hold: true,
      })
    ) {
      faced += 1;
    }
    const shot = ctx.getImageData(0, 0, w, h);
    rgba.push(shot.data);
    if (i % 2 === 0 || i === total - 1) {
      opts.onProgress({ done: i + 1, total, label: "Recasting GIF" });
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  if (faced < Math.min(3, rgba.length)) {
    throw new RecastError("No face in that GIF. Use one with a clear, front-facing face.");
  }
  opts.onProgress({ done: total, total, label: "Wrapping the GIF" });
  await new Promise((resolve) => setTimeout(resolve, 0));
  return encodeGif(rgba, w, h, slice.delays.slice(0, rgba.length));
}
