import {
  CHEEK_INDICES,
  OVAL,
  affine,
  boxBlur,
  triArea,
  type Pt,
} from "@/lib/faceswap/geometry";

export type RGB = [number, number, number];

type Matched = { indices: number[]; points: Pt[] };

function usable(points: Pt[], indices: readonly number[]): Matched {
  const out: Matched = { indices: [], points: [] };
  for (const index of indices) {
    const p = points[index];
    if (!p) continue;
    out.indices.push(index);
    out.points.push(p);
  }
  return out;
}

export function sampleMean(data: ImageData, points: Pt[]): RGB | null {
  const { width, height } = data;
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  const px = data.data;
  for (const p of points) {
    const x = Math.round(p.x);
    const y = Math.round(p.y);
    if (x < 1 || y < 1 || x >= width - 1 || y >= height - 1) continue;
    const i = (y * width + x) * 4;
    r += px[i]!;
    g += px[i + 1]!;
    b += px[i + 2]!;
    n += 1;
  }
  if (n < 3) return null;
  return [r / n, g / n, b / n];
}

export function cheekPoints(full: Pt[]): Pt[] {
  return usable(full, CHEEK_INDICES).points;
}

function grow(a: Pt, b: Pt, c: Pt, px: number): [Pt, Pt, Pt] {
  const cx = (a.x + b.x + c.x) / 3;
  const cy = (a.y + b.y + c.y) / 3;
  const push = (p: Pt): Pt => {
    const dx = p.x - cx;
    const dy = p.y - cy;
    const len = Math.hypot(dx, dy) || 1;
    return { x: p.x + (dx / len) * px, y: p.y + (dy / len) * px };
  };
  return [push(a), push(b), push(c)];
}

function clipOval(
  ctx: CanvasRenderingContext2D,
  indices: number[],
  dst: Pt[],
  minX: number,
  minY: number,
) {
  const pos = new Map<number, number>();
  indices.forEach((orig, j) => pos.set(orig, j));
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = "destination-in";
  ctx.beginPath();
  let moved = false;
  for (const id of OVAL) {
    const j = pos.get(id);
    if (j === undefined) continue;
    const p = dst[j];
    if (!p) continue;
    const x = p.x - minX;
    const y = p.y - minY;
    if (!moved) {
      ctx.moveTo(x, y);
      moved = true;
    } else {
      ctx.lineTo(x, y);
    }
  }
  if (!moved) {
    ctx.globalCompositeOperation = "source-over";
    return;
  }
  ctx.closePath();
  ctx.lineJoin = "round";
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.fill();
  ctx.globalCompositeOperation = "source-over";
}

function shift(v: number, from: number, to: number, lighting: boolean): number {
  const next = lighting ? (v - from) * 0.92 + to : v;
  return next < 0 ? 0 : next > 255 ? 255 : next;
}

export function paintFace(opts: {
  frame: CanvasRenderingContext2D;
  frameW: number;
  frameH: number;
  photo: HTMLCanvasElement;
  src: Pt[];
  dst: Pt[];
  indices: number[];
  triangles: Uint32Array;
  srcMean: RGB | null;
  dstMean: RGB | null;
  lighting: boolean;
  warp: HTMLCanvasElement;
}): void {
  const { frame, frameW, frameH, photo, src, dst, indices, triangles, lighting, warp } = opts;
  let minX = frameW;
  let minY = frameH;
  let maxX = 0;
  let maxY = 0;
  for (const p of dst) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  const faceW = maxX - minX;
  const faceH = maxY - minY;
  if (faceW < 12 || faceH < 12) return;
  const pad = Math.max(10, Math.round(Math.max(faceW, faceH) * 0.08));
  minX = Math.max(0, Math.floor(minX) - pad);
  minY = Math.max(0, Math.floor(minY) - pad);
  maxX = Math.min(frameW, Math.ceil(maxX) + pad);
  maxY = Math.min(frameH, Math.ceil(maxY) + pad);
  const bw = maxX - minX;
  const bh = maxY - minY;
  if (bw < 8 || bh < 8) return;
  if (warp.width !== bw || warp.height !== bh) {
    warp.width = bw;
    warp.height = bh;
  }
  const wctx = warp.getContext("2d", { willReadFrequently: true });
  if (!wctx) return;
  wctx.setTransform(1, 0, 0, 1, 0, 0);
  wctx.globalCompositeOperation = "source-over";
  wctx.clearRect(0, 0, bw, bh);
  wctx.imageSmoothingEnabled = true;
  wctx.imageSmoothingQuality = "high";

  for (let t = 0; t < triangles.length; t += 3) {
    const i0 = triangles[t]!;
    const i1 = triangles[t + 1]!;
    const i2 = triangles[t + 2]!;
    const s0 = src[i0];
    const s1 = src[i1];
    const s2 = src[i2];
    const d0 = dst[i0];
    const d1 = dst[i1];
    const d2 = dst[i2];
    if (!s0 || !s1 || !s2 || !d0 || !d1 || !d2) continue;
    if (Math.abs(triArea(s0, s1, s2)) < 1.2 || Math.abs(triArea(d0, d1, d2)) < 1.2) continue;
    const [g0, g1, g2] = grow(
      { x: d0.x - minX, y: d0.y - minY },
      { x: d1.x - minX, y: d1.y - minY },
      { x: d2.x - minX, y: d2.y - minY },
      0.8,
    );
    const m = affine(s0, s1, s2, g0, g1, g2);
    if (!m) continue;
    wctx.save();
    wctx.beginPath();
    wctx.moveTo(g0.x, g0.y);
    wctx.lineTo(g1.x, g1.y);
    wctx.lineTo(g2.x, g2.y);
    wctx.closePath();
    wctx.clip();
    wctx.setTransform(m.a, m.b, m.c, m.d, m.e, m.f);
    wctx.drawImage(photo, 0, 0);
    wctx.restore();
  }

  clipOval(wctx, indices, dst, minX, minY);

  const warped = wctx.getImageData(0, 0, bw, bh);
  const hard = new Uint8Array(bw * bh);
  const wd = warped.data;
  for (let i = 0; i < hard.length; i++) hard[i] = wd[i * 4 + 3]! > 20 ? 255 : 0;
  const feather = Math.max(2, Math.round(faceW * 0.035));
  const soft = boxBlur(boxBlur(hard, bw, bh, feather), bw, bh, Math.max(1, feather >> 1));
  const base = frame.getImageData(minX, minY, bw, bh);
  const bd = base.data;
  const srcMean = opts.srcMean;
  const dstMean = opts.dstMean;
  const match = Boolean(lighting && srcMean && dstMean);
  for (let i = 0; i < hard.length; i++) {
    if (!hard[i]) continue;
    const a = soft[i]! / 255;
    if (a < 0.02) continue;
    const o = i * 4;
    const wr = wd[o]!;
    const wg = wd[o + 1]!;
    const wb = wd[o + 2]!;
    const r = match ? shift(wr, srcMean![0], dstMean![0], true) : wr;
    const g = match ? shift(wg, srcMean![1], dstMean![1], true) : wg;
    const b = match ? shift(wb, srcMean![2], dstMean![2], true) : wb;
    bd[o] = r * a + bd[o]! * (1 - a);
    bd[o + 1] = g * a + bd[o + 1]! * (1 - a);
    bd[o + 2] = b * a + bd[o + 2]! * (1 - a);
    bd[o + 3] = 255;
  }
  frame.putImageData(base, minX, minY);
}
