import {
  FACE_MESH_INDICES,
  alignAndBlend,
  insetPoints,
  largestFace,
  take,
  toPixels,
  triangulate,
  type Norm,
  type Pt,
} from "@/lib/faceswap/geometry";
import { cheekPoints, sampleMean, type RGB } from "@/lib/faceswap/warp";

export class RecastError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RecastError";
  }
}

type Landmarker = {
  detect: (image: HTMLCanvasElement) => { faceLandmarks: Norm[][] };
  detectForVideo: (image: HTMLCanvasElement, timestamp: number) => { faceLandmarks: Norm[][] };
  setOptions: (options: { runningMode?: "IMAGE" | "VIDEO"; numFaces?: number }) => Promise<void>;
  close?: () => void;
};

export type PhotoMesh = {
  canvas: HTMLCanvasElement;
  full: Pt[];
  indices: number[];
  src: Pt[];
  triangles: Uint32Array;
  mean: RGB | null;
};

let filesetPromise: Promise<unknown> | null = null;
let modelPromise: Promise<Uint8Array> | null = null;
let landmarkerPromise: Promise<Landmarker> | null = null;
let mode: "IMAGE" | "VIDEO" = "IMAGE";

function loadModel(): Promise<Uint8Array> {
  modelPromise ??= fetch("/models/face_landmarker.task").then(async (res) => {
    if (!res.ok) throw new RecastError("The face tracker didn't load. Refresh and try again.");
    return new Uint8Array(await res.arrayBuffer());
  });
  return modelPromise;
}

async function fileset(): Promise<unknown> {
  filesetPromise ??= (async () => {
    const { FilesetResolver } = await import("@mediapipe/tasks-vision");
    return FilesetResolver.forVisionTasks("/mediapipe");
  })();
  return filesetPromise;
}

export function getLandmarker(): Promise<Landmarker> {
  landmarkerPromise ??= (async () => {
    const [{ FaceLandmarker }, wasm, model] = await Promise.all([
      import("@mediapipe/tasks-vision"),
      fileset(),
      loadModel(),
    ]);
    const gpuBuffer = model.slice();
    const cpuBuffer = model.slice();
    const options = {
      runningMode: "IMAGE" as const,
      numFaces: 3,
      minFaceDetectionConfidence: 0.4,
      minFacePresenceConfidence: 0.4,
      minTrackingConfidence: 0.4,
      outputFaceBlendshapes: false,
      outputFacialTransformationMatrixes: false,
    };
    try {
      return await FaceLandmarker.createFromOptions(wasm as never, {
        baseOptions: { modelAssetBuffer: gpuBuffer, delegate: "GPU" },
        ...options,
      });
    } catch {
      return FaceLandmarker.createFromOptions(wasm as never, {
        baseOptions: { modelAssetBuffer: cpuBuffer, delegate: "CPU" },
        ...options,
      });
    }
  })();
  return landmarkerPromise;
}

async function ensureMode(next: "IMAGE" | "VIDEO"): Promise<Landmarker> {
  const marker = await getLandmarker();
  if (mode !== next) {
    await marker.setOptions({ runningMode: next });
    mode = next;
  }
  return marker;
}

function readFace(raw: Norm[] | null, width: number, height: number): Pt[] | null {
  if (!raw || raw.length < 264) return null;
  return toPixels(raw, width, height);
}

export async function preparePhoto(source: HTMLCanvasElement, flip: boolean): Promise<PhotoMesh> {
  const canvas = document.createElement("canvas");
  canvas.width = source.width;
  canvas.height = source.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new RecastError("Couldn't read that photo.");
  if (flip) {
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(source, 0, 0);
  const marker = await ensureMode("IMAGE");
  const found = largestFace(marker.detect(canvas).faceLandmarks);
  const full = readFace(found, canvas.width, canvas.height);
  if (!full) {
    throw new RecastError("No face in that photo. Use a clear, front-facing shot.");
  }
  const indices = FACE_MESH_INDICES.filter((i) => i < full.length);
  const subset = take(full, indices);
  if (!subset) throw new RecastError("Couldn't map that face. Try another photo.");
  const src = insetPoints(subset, 0.03);
  const photoData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return {
    canvas,
    full,
    indices,
    src,
    triangles: triangulate(src),
    mean: sampleMean(photoData, cheekPoints(full)),
  };
}

export type FaceFit = {
  dst: Pt[];
  indices: number[];
  mean: RGB | null;
};

export function fitFace(
  mesh: PhotoMesh,
  landmarks: Norm[] | null,
  width: number,
  height: number,
  follow: number,
  frame: ImageData,
  previous: Pt[] | null,
): { fit: FaceFit | null; smoothed: Pt[] | null } {
  const full = readFace(landmarks, width, height);
  if (!full || mesh.indices.some((index) => index >= full.length)) {
    return { fit: null, smoothed: previous };
  }
  const blended = alignAndBlend(mesh.full, full, follow);
  if (!blended) return { fit: null, smoothed: previous };
  const dst = take(blended, mesh.indices);
  if (!dst) return { fit: null, smoothed: previous };
  let smoothed = dst;
  if (previous && previous.length === dst.length) {
    smoothed = dst.map((p, i) => ({
      x: previous[i]!.x * 0.35 + p.x * 0.65,
      y: previous[i]!.y * 0.35 + p.y * 0.65,
    }));
  }
  const mean = sampleMean(frame, cheekPoints(full));
  return { fit: { dst: smoothed, indices: mesh.indices, mean }, smoothed };
}

export async function detectStill(canvas: HTMLCanvasElement): Promise<Norm[] | null> {
  const marker = await ensureMode("IMAGE");
  return largestFace(marker.detect(canvas).faceLandmarks);
}

let lastVideoTs = 0;

export async function detectVideo(canvas: HTMLCanvasElement): Promise<Norm[] | null> {
  const marker = await ensureMode("VIDEO");
  lastVideoTs = Math.max(lastVideoTs + 1, Math.round(performance.now()));
  return largestFace(marker.detectForVideo(canvas, lastVideoTs).faceLandmarks);
}
