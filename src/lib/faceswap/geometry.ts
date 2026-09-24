import Delaunator from "delaunator";

export type Pt = { x: number; y: number };

const RAW_MESH = [
  10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152,
  148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109, 151, 9, 8, 69,
  299, 104, 333, 68, 298, 70, 63, 105, 66, 107, 55, 65, 52, 53, 46, 300, 293, 334, 296, 336, 285,
  295, 282, 283, 276, 33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246,
  263, 249, 390, 373, 374, 380, 381, 382, 362, 398, 384, 385, 386, 387, 388, 466, 168, 6, 197, 195, 5, 4, 1, 19, 94, 2, 98, 97, 326, 327, 64,
  294, 278, 331, 102, 49, 279, 48, 115, 131, 134, 51, 281, 360, 363, 61, 146, 91, 181, 84, 17, 314,
  405, 321, 375, 291, 409, 270, 269, 267, 0, 37, 39, 40, 185, 78, 95, 88, 178, 87, 14, 317, 402,
  318, 324, 308, 415, 310, 311, 312, 13, 82, 81, 80, 191, 117, 118, 119, 100, 101, 36, 205, 50,
  187, 207, 216, 212, 202, 204, 194, 123, 147, 213, 192, 214, 210, 211, 32, 140, 171, 346, 347,
  348, 329, 330, 266, 425, 280, 411, 427, 436, 432, 422, 424, 418, 352, 376, 433, 416, 434, 430,
  431, 262, 369, 396, 18, 175, 199, 200, 208, 428, 421, 313, 83, 43, 106, 182, 406, 335, 273, 111,
  120, 121, 128, 245, 340, 349, 350, 357, 465, 143, 116, 345, 372,
];

export const FACE_MESH_INDICES: readonly number[] = [...new Set(RAW_MESH)];

export const OVAL: readonly number[] = [
  10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152,
  148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109,
];

export const CHEEK_INDICES: readonly number[] = [117, 187, 205, 50, 346, 411, 425, 280];

const LEFT_EYE = 33;
const RIGHT_EYE = 263;
const NOSE = 4;

export type Norm = { x: number; y: number };

export function toPixels(points: Norm[], width: number, height: number): Pt[] {
  return points.map((p) => ({ x: p.x * width, y: p.y * height }));
}

export function take(points: Pt[], indices: readonly number[]): Pt[] | null {
  const out: Pt[] = [];
  for (const index of indices) {
    const p = points[index];
    if (!p) return null;
    out.push(p);
  }
  return out;
}

export function insetPoints(points: Pt[], amount: number): Pt[] {
  let cx = 0;
  let cy = 0;
  for (const p of points) {
    cx += p.x;
    cy += p.y;
  }
  cx /= points.length;
  cy /= points.length;
  const k = 1 - amount;
  return points.map((p) => ({ x: cx + (p.x - cx) * k, y: cy + (p.y - cy) * k }));
}

export function alignAndBlend(src: Pt[], dst: Pt[], follow: number): Pt[] | null {
  const n = Math.min(src.length, dst.length);
  if (n <= RIGHT_EYE || n <= NOSE) return null;
  const sL = src[LEFT_EYE];
  const sR = src[RIGHT_EYE];
  const dL = dst[LEFT_EYE];
  const dR = dst[RIGHT_EYE];
  if (!sL || !sR || !dL || !dR || !src[NOSE] || !dst[NOSE]) return null;
  const sLen = Math.hypot(sR.x - sL.x, sR.y - sL.y);
  const dLen = Math.hypot(dR.x - dL.x, dR.y - dL.y);
  if (sLen < 4 || dLen < 4) return null;
  const scale = dLen / sLen;
  const rot = Math.atan2(dR.y - dL.y, dR.x - dL.x) - Math.atan2(sR.y - sL.y, sR.x - sL.x);
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  const sAnchor = { x: (sL.x + sR.x) / 2, y: (sL.y + sR.y) / 2 };
  const dAnchor = { x: (dL.x + dR.x) / 2, y: (dL.y + dR.y) / 2 };
  const f = Math.min(1, Math.max(0, follow));
  const out: Pt[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const p = src[i];
    const q = dst[i];
    if (!p || !q) return null;
    const x = p.x - sAnchor.x;
    const y = p.y - sAnchor.y;
    const rx = (x * cos - y * sin) * scale + dAnchor.x;
    const ry = (x * sin + y * cos) * scale + dAnchor.y;
    out[i] = { x: rx + (q.x - rx) * f, y: ry + (q.y - ry) * f };
  }
  return out;
}

export function triangulate(points: Pt[]): Uint32Array {
  const coords = new Float64Array(points.length * 2);
  for (let i = 0; i < points.length; i++) {
    coords[i * 2] = points[i]!.x;
    coords[i * 2 + 1] = points[i]!.y;
  }
  return new Delaunator(coords).triangles;
}

export type Mat = { a: number; b: number; c: number; d: number; e: number; f: number };

export function affine(s0: Pt, s1: Pt, s2: Pt, d0: Pt, d1: Pt, d2: Pt): Mat | null {
  const den = s0.x * (s1.y - s2.y) + s1.x * (s2.y - s0.y) + s2.x * (s0.y - s1.y);
  if (Math.abs(den) < 1e-4) return null;
  return {
    a: (d0.x * (s1.y - s2.y) + d1.x * (s2.y - s0.y) + d2.x * (s0.y - s1.y)) / den,
    c: (d0.x * (s2.x - s1.x) + d1.x * (s0.x - s2.x) + d2.x * (s1.x - s0.x)) / den,
    e:
      (d0.x * (s1.x * s2.y - s2.x * s1.y) +
        d1.x * (s2.x * s0.y - s0.x * s2.y) +
        d2.x * (s0.x * s1.y - s1.x * s0.y)) /
      den,
    b: (d0.y * (s1.y - s2.y) + d1.y * (s2.y - s0.y) + d2.y * (s0.y - s1.y)) / den,
    d: (d0.y * (s2.x - s1.x) + d1.y * (s0.x - s2.x) + d2.y * (s1.x - s0.x)) / den,
    f:
      (d0.y * (s1.x * s2.y - s2.x * s1.y) +
        d1.y * (s2.x * s0.y - s0.x * s2.y) +
        d2.y * (s0.x * s1.y - s1.x * s0.y)) /
      den,
  };
}

export function applyMat(m: Mat, p: Pt): Pt {
  return { x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f };
}

export function triArea(a: Pt, b: Pt, c: Pt): number {
  return (b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y);
}

export function targetSize(width: number, height: number, longSide: number): { w: number; h: number } {
  const long = Math.max(width, height);
  const scale = Math.min(1, longSide / long);
  let w = Math.max(2, Math.round(width * scale));
  let h = Math.max(2, Math.round(height * scale));
  if (w % 2) w -= 1;
  if (h % 2) h -= 1;
  return { w: Math.max(2, w), h: Math.max(2, h) };
}

export function boxBlur(src: Uint8Array, w: number, h: number, r: number): Uint8Array {
  if (r <= 0) return src;
  const tmp = new Uint8Array(src.length);
  const dst = new Uint8Array(src.length);
  const div = r * 2 + 1;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let sum = 0;
    for (let k = -r; k <= r; k++) {
      const x = k < 0 ? 0 : k >= w ? w - 1 : k;
      sum += src[row + x]!;
    }
    for (let x = 0; x < w; x++) {
      tmp[row + x] = (sum / div) | 0;
      const xOut = x - r;
      const xIn = x + r + 1;
      sum -= src[row + (xOut < 0 ? 0 : xOut >= w ? w - 1 : xOut)]!;
      sum += src[row + (xIn < 0 ? 0 : xIn >= w ? w - 1 : xIn)]!;
    }
  }
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let k = -r; k <= r; k++) {
      const y = k < 0 ? 0 : k >= h ? h - 1 : k;
      sum += tmp[y * w + x]!;
    }
    for (let y = 0; y < h; y++) {
      dst[y * w + x] = (sum / div) | 0;
      const yOut = y - r;
      const yIn = y + r + 1;
      sum -= tmp[(yOut < 0 ? 0 : yOut >= h ? h - 1 : yOut) * w + x]!;
      sum += tmp[(yIn < 0 ? 0 : yIn >= h ? h - 1 : yIn) * w + x]!;
    }
  }
  return dst;
}

export function largestFace(faces: Norm[][]): Norm[] | null {
  let best: Norm[] | null = null;
  let bestArea = 0;
  for (const face of faces) {
    let minX = 1;
    let minY = 1;
    let maxX = 0;
    let maxY = 0;
    for (const p of face) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
    const area = (maxX - minX) * (maxY - minY);
    if (area > bestArea) {
      bestArea = area;
      best = face;
    }
  }
  return best;
}

export const MAX_SECONDS = 12;

export const QUALITY = {
  fast: { longSide: 640, fps: 15 },
  sharp: { longSide: 960, fps: 24 },
} as const;

export type Quality = keyof typeof QUALITY;

export function clipSpan(duration: number, start: number): number {
  if (!Number.isFinite(duration) || duration <= 0) return 0;
  const begin = Math.min(Math.max(0, start), Math.max(0, duration - 0.2));
  return Math.max(0.35, Math.min(MAX_SECONDS, duration - begin));
}
