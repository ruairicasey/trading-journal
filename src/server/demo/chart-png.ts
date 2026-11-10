/**
 * Minimal PNG encoder + synthetic candlestick chart for the DEMO account's screenshots.
 * Pure Node (zlib); no image libraries. Output is clearly fake data drawn from a seeded random walk.
 */
import { deflateSync } from "node:zlib";
import type { Rng } from "./rng";

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(buf: Uint8Array) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array) {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  out.set(new TextEncoder().encode(type), 4);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** Encode an RGB buffer (width*height*3 bytes) as PNG. */
export function encodePng(width: number, height: number, rgb: Uint8Array): Uint8Array {
  const raw = new Uint8Array((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0; // filter: none
    raw.set(rgb.subarray(y * width * 3, (y + 1) * width * 3), y * (width * 3 + 1) + 1);
  }
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, width);
  dv.setUint32(4, height);
  ihdr.set([8, 2, 0, 0, 0], 8); // 8-bit, RGB, deflate, no filter, no interlace
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", new Uint8Array(deflateSync(raw, { level: 9 }))),
    chunk("IEND", new Uint8Array()),
  ];
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

type RGB = [number, number, number];
const BG: RGB = [13, 15, 20];
const GRID: RGB = [28, 32, 40];
const UP: RGB = [52, 199, 132];
const DOWN: RGB = [239, 83, 80];
const ENTRY: RGB = [96, 165, 250];
const MUTED: RGB = [90, 96, 110];

/** Draw a fake chart: candles around `entry`, with entry/stop/target lines. */
export function demoChartPng(rng: Rng, opts: { entry: number; stop: number; target: number; direction: "long" | "short"; width?: number; height?: number }) {
  const W = opts.width ?? 960;
  const H = opts.height ?? 540;
  const px = new Uint8Array(W * H * 3);
  const set = (x: number, y: number, c: RGB) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const i = (y * W + x) * 3;
    px[i] = c[0];
    px[i + 1] = c[1];
    px[i + 2] = c[2];
  };
  const rect = (x0: number, y0: number, x1: number, y1: number, c: RGB) => {
    for (let y = Math.round(Math.min(y0, y1)); y <= Math.round(Math.max(y0, y1)); y++)
      for (let x = Math.round(x0); x <= Math.round(x1); x++) set(x, y, c);
  };
  rect(0, 0, W - 1, H - 1, BG);
  for (let x = 0; x < W; x += 80) rect(x, 0, x, H - 1, GRID);
  for (let y = 0; y < H; y += 60) rect(0, y, W - 1, y, GRID);

  // random-walk candles that reach the entry about 60% of the way across, then head toward the outcome
  const n = 64;
  const vol = Math.abs(opts.entry - opts.stop) * 0.35 || opts.entry * 0.002;
  const candles: { o: number; h: number; l: number; c: number }[] = [];
  let p = opts.entry + (opts.direction === "long" ? 1 : -1) * vol * 6 * (rng.next() - 0.2);
  const entryAt = Math.floor(n * 0.6);
  for (let i = 0; i < n; i++) {
    const pull = i < entryAt ? (opts.entry - p) / (entryAt - i + 1) : (rng.next() < 0.55 ? opts.target - p : opts.stop - p) / 12;
    const o = p;
    const c = o + pull + vol * rng.normal() * 0.6;
    const h = Math.max(o, c) + Math.abs(rng.normal()) * vol * 0.4;
    const l = Math.min(o, c) - Math.abs(rng.normal()) * vol * 0.4;
    candles.push({ o, h, l, c });
    p = c;
  }
  const lo = Math.min(opts.stop, opts.target, ...candles.map((c) => c.l));
  const hi = Math.max(opts.stop, opts.target, ...candles.map((c) => c.h));
  const pad = (hi - lo) * 0.08;
  const y = (v: number) => H - 20 - ((v - (lo - pad)) / (hi - lo + 2 * pad)) * (H - 40);
  const cw = (W - 60) / n;

  const dashed = (v: number, c: RGB) => {
    for (let x = 0; x < W; x++) if (Math.floor(x / 8) % 2 === 0) rect(x, y(v), x, y(v) + 1, c);
  };
  dashed(opts.stop, DOWN);
  dashed(opts.target, UP);
  dashed(opts.entry, ENTRY);

  candles.forEach((k, i) => {
    const x = 20 + i * cw;
    const col = k.c >= k.o ? UP : DOWN;
    rect(x + cw / 2, y(k.h), x + cw / 2, y(k.l), col);
    rect(x + 2, y(k.o), x + cw - 3, y(k.c), col);
  });
  // entry marker
  const ex = 20 + entryAt * cw + cw / 2;
  for (let d = 0; d < 9; d++) rect(ex - d, y(opts.entry) + (opts.direction === "long" ? 12 + d : -12 - d), ex + d, y(opts.entry) + (opts.direction === "long" ? 12 + d : -12 - d), ENTRY);
  rect(0, H - 4, W - 1, H - 1, MUTED); // "DEMO" footer band
  return encodePng(W, H, px);
}
