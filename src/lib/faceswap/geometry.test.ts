import assert from "node:assert/strict";
import test from "node:test";
import { affine, alignAndBlend, applyMat, boxBlur, clipSpan, type Pt } from "./geometry.ts";

function face(shiftX: number, shiftY: number, scale: number): Pt[] {
  const pts: Pt[] = Array.from({ length: 300 }, (_, i) => ({
    x: shiftX + (i % 20) * scale,
    y: shiftY + Math.floor(i / 20) * scale,
  }));
  pts[33] = { x: shiftX, y: shiftY };
  pts[263] = { x: shiftX + 20 * scale, y: shiftY };
  pts[4] = { x: shiftX + 10 * scale, y: shiftY + 12 * scale };
  return pts;
}

test("affine maps triangle corners", () => {
  const s0 = { x: 0, y: 0 };
  const s1 = { x: 10, y: 0 };
  const s2 = { x: 0, y: 8 };
  const d0 = { x: 3, y: 4 };
  const d1 = { x: 23, y: 6 };
  const d2 = { x: 5, y: 20 };
  const m = affine(s0, s1, s2, d0, d1, d2);
  assert.ok(m);
  const near = (a: Pt, b: Pt) => {
    assert.ok(Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6);
  };
  near(applyMat(m, s0), d0);
  near(applyMat(m, s1), d1);
  near(applyMat(m, s2), d2);
});

test("full motion match lands on the clip landmarks", () => {
  const src = face(10, 30, 1);
  const dst = face(80, 40, 2);
  const blended = alignAndBlend(src, dst, 1);
  assert.ok(blended);
  assert.ok(Math.abs(blended[33]!.x - dst[33]!.x) < 1e-6);
  assert.ok(Math.abs(blended[4]!.y - dst[4]!.y) < 1e-6);
});

test("shape lock keeps the eyes on the clip and the user's proportions", () => {
  const src = face(0, 0, 1);
  const dst = face(100, 50, 2);
  const blended = alignAndBlend(src, dst, 0);
  assert.ok(blended);
  assert.ok(Math.abs(blended[33]!.x - dst[33]!.x) < 1e-6);
  assert.ok(Math.abs(blended[263]!.x - dst[263]!.x) < 1e-6);
  const userNoseOffset = src[4]!.y - src[33]!.y;
  const placedNoseOffset = blended[4]!.y - blended[33]!.y;
  assert.ok(Math.abs(placedNoseOffset - userNoseOffset * 2) < 1e-6);
});

test("box blur keeps a solid interior and softens an edge", () => {
  const w = 9;
  const h = 1;
  const src = new Uint8Array(w);
  src[4] = 255;
  const out = boxBlur(src, w, h, 1);
  assert.ok(out[4]! < 255);
  assert.ok(out[4]! > out[0]!);
  assert.equal(out[0], out[8]);
});

test("clip span caps a reel at 12 seconds", () => {
  assert.equal(clipSpan(30, 2), 12);
  assert.equal(clipSpan(8, 1), 7);
});
