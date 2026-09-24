import { ArrayBufferTarget, Muxer } from "mp4-muxer";

export type Pcm = { left: Float32Array; right: Float32Array; sampleRate: number };

export async function readPcm(
  file: File,
  start: number,
  duration: number,
  fullDuration: number,
): Promise<Pcm | null> {
  if (typeof OfflineAudioContext === "undefined") return null;
  if (!Number.isFinite(fullDuration) || fullDuration > 240) return null;
  if (file.size > 90_000_000) return null;
  try {
    const copy = (await file.arrayBuffer()).slice(0);
    const ctx = new OfflineAudioContext(1, 1, 44100);
    const audio = await ctx.decodeAudioData(copy);
    const rate = audio.sampleRate;
    if (rate !== 44100 && rate !== 48000) return null;
    const s0 = Math.max(0, Math.floor(start * rate));
    const len = Math.max(1, Math.floor(duration * rate));
    const take = (channel: number) => {
      const src = audio.getChannelData(Math.min(channel, audio.numberOfChannels - 1));
      const out = new Float32Array(len);
      for (let i = 0; i < len; i++) out[i] = src[s0 + i] ?? 0;
      return out;
    };
    const left = take(0);
    const right = audio.numberOfChannels > 1 ? take(1) : left.slice();
    return { left, right, sampleRate: rate };
  } catch {
    return null;
  }
}

export type FrameSink = {
  push: (canvas: HTMLCanvasElement, index: number) => Promise<void>;
  finish: () => Promise<{ blob: Blob; ext: "mp4" | "webm" }>;
};

const CODECS = ["avc1.42001f", "avc1.4d001f", "avc1.640028", "avc1.42E01F"];

async function pickVideoConfig(width: number, height: number, fps: number) {
  if (typeof VideoEncoder === "undefined") return null;
  const bitrate = Math.min(6_000_000, Math.max(800_000, Math.round(width * height * fps * 0.11)));
  for (const codec of CODECS) {
    const config: VideoEncoderConfig = {
      codec,
      width,
      height,
      bitrate,
      framerate: fps,
      hardwareAcceleration: "prefer-hardware",
      avc: { format: "avc" },
      latencyMode: "quality",
    };
    try {
      const supported = await VideoEncoder.isConfigSupported(config);
      if (supported.supported) return supported.config ?? config;
    } catch {
      // try the next profile
    }
  }
  return null;
}

function jpegBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("frame"))),
      "image/jpeg",
      0.9,
    );
  });
}

async function recordPlayback(opts: {
  frames: Blob[];
  fps: number;
  width: number;
  height: number;
  audioEl: HTMLVideoElement | null;
  audioStart: number;
}): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = opts.width;
  canvas.height = opts.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas");
  const first = await createImageBitmap(opts.frames[0]!);
  ctx.drawImage(first, 0, 0, opts.width, opts.height);
  first.close();
  const canvasStream = canvas.captureStream(opts.fps);
  const tracks: MediaStreamTrack[] = [...canvasStream.getVideoTracks()];
  const audioEl = opts.audioEl;
  if (audioEl) {
    const capture = (audioEl as HTMLVideoElement & { captureStream?: () => MediaStream }).captureStream;
    try {
      audioEl.currentTime = opts.audioStart;
      await audioEl.play();
      const stream = capture?.call(audioEl);
      if (stream) tracks.push(...stream.getAudioTracks());
    } catch {
      audioEl.pause();
    }
  }
  const mime = MediaRecorder.isTypeSupported("video/mp4")
    ? "video/mp4"
    : MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus")
      ? "video/webm;codecs=vp9,opus"
      : MediaRecorder.isTypeSupported("video/webm")
        ? "video/webm"
        : "";
  const rec = new MediaRecorder(
    new MediaStream(tracks),
    mime ? { mimeType: mime, videoBitsPerSecond: 2_500_000 } : undefined,
  );
  const chunks: Blob[] = [];
  rec.ondataavailable = (event) => {
    if (event.data.size) chunks.push(event.data);
  };
  const stopped = new Promise<void>((resolve) => {
    rec.onstop = () => resolve();
  });
  rec.start(200);
  const started = performance.now();
  const total = (opts.frames.length / opts.fps) * 1000;
  let shown = 0;
  let bitmap = await createImageBitmap(opts.frames[0]!);
  while (performance.now() - started < total) {
    const index = Math.min(
      opts.frames.length - 1,
      Math.floor(((performance.now() - started) / 1000) * opts.fps),
    );
    if (index !== shown) {
      shown = index;
      bitmap.close();
      bitmap = await createImageBitmap(opts.frames[index]!);
      ctx.drawImage(bitmap, 0, 0, opts.width, opts.height);
    }
    await new Promise((resolve) => requestAnimationFrame(resolve));
  }
  bitmap.close();
  audioEl?.pause();
  rec.stop();
  await stopped;
  return new Blob(chunks, { type: rec.mimeType || "video/webm" });
}

function encodePcm(encoder: AudioEncoder, pcm: Pcm) {
  const frame = 1024;
  const { left, right, sampleRate } = pcm;
  for (let offset = 0; offset < left.length; offset += frame) {
    const count = Math.min(frame, left.length - offset);
    const planar = new Float32Array(count * 2);
    planar.set(left.subarray(offset, offset + count), 0);
    planar.set(right.subarray(offset, offset + count), count);
    const data = new AudioData({
      format: "f32-planar",
      sampleRate,
      numberOfFrames: count,
      numberOfChannels: 2,
      timestamp: Math.round((offset / sampleRate) * 1_000_000),
      data: planar,
    });
    encoder.encode(data);
    data.close();
  }
}

export async function openSink(opts: {
  width: number;
  height: number;
  fps: number;
  pcm: Pcm | null;
  audioEl: HTMLVideoElement | null;
  audioStart: number;
}): Promise<FrameSink> {
  const videoConfig = await pickVideoConfig(opts.width, opts.height, opts.fps);
  if (!videoConfig || typeof VideoEncoder === "undefined") {
    const frames: Blob[] = [];
    return {
      push: async (canvas) => {
        frames.push(await jpegBlob(canvas));
      },
      finish: async () => {
        const blob = await recordPlayback({
          frames,
          fps: opts.fps,
          width: opts.width,
          height: opts.height,
          audioEl: opts.audioEl,
          audioStart: opts.audioStart,
        });
        return { blob, ext: blob.type.includes("mp4") ? "mp4" : "webm" };
      },
    };
  }

  let failed: Error | null = null;
  const audioConfig: AudioEncoderConfig | null =
    opts.pcm && typeof AudioEncoder !== "undefined"
      ? {
          codec: "mp4a.40.2",
          sampleRate: opts.pcm.sampleRate,
          numberOfChannels: 2,
          bitrate: 128_000,
        }
      : null;
  let useAudio = false;
  if (audioConfig && typeof AudioEncoder !== "undefined") {
    try {
      useAudio = (await AudioEncoder.isConfigSupported(audioConfig)).supported === true;
    } catch {
      useAudio = false;
    }
  }

  const target = new ArrayBufferTarget();
  const muxer = new Muxer({
    target,
    video: { codec: "avc", width: opts.width, height: opts.height, frameRate: opts.fps },
    audio: useAudio
      ? { codec: "aac", numberOfChannels: 2, sampleRate: opts.pcm!.sampleRate }
      : undefined,
    fastStart: "in-memory",
    firstTimestampBehavior: "offset",
  });

  const videoEncoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (error) => {
      failed = error instanceof Error ? error : new Error("Video encode failed");
    },
  });
  videoEncoder.configure(videoConfig);

  let audioEncoder: AudioEncoder | null = null;
  if (useAudio && audioConfig) {
    audioEncoder = new AudioEncoder({
      output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
      error: (error) => {
        failed = error instanceof Error ? error : new Error("Audio encode failed");
      },
    });
    audioEncoder.configure(audioConfig);
  }

  const frameUs = Math.round(1_000_000 / opts.fps);
  return {
    push: async (canvas, index) => {
      if (failed) throw failed;
      while (videoEncoder.encodeQueueSize > 6) {
        await new Promise((resolve) => setTimeout(resolve, 8));
      }
      const frame = new VideoFrame(canvas, {
        timestamp: index * frameUs,
        duration: frameUs,
      });
      videoEncoder.encode(frame, { keyFrame: index % opts.fps === 0 });
      frame.close();
    },
    finish: async () => {
      if (failed) throw failed;
      await videoEncoder.flush();
      if (audioEncoder && opts.pcm) {
        encodePcm(audioEncoder, opts.pcm);
        await audioEncoder.flush();
      }
      videoEncoder.close();
      audioEncoder?.close();
      if (failed) throw failed;
      muxer.finalize();
      return { blob: new Blob([target.buffer], { type: "video/mp4" }), ext: "mp4" };
    },
  };
}
