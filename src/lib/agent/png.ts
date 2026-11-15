// A small PNG reader for GIBS map images: 8-bit greyscale, RGB, palette or
// RGBA, not interlaced (what GIBS serves). Returns RGBA pixels, row by row.
import "server-only";

import { inflateSync } from "node:zlib";

export interface Pixels {
  width: number;
  height: number;
  /** 4 bytes a pixel: r, g, b, a. */
  rgba: Uint8Array;
  /** For a palette image, each pixel's palette index (GIBS data tiles: the colormap entry). */
  index: Uint8Array | null;
}

export function decodePng(buf: Uint8Array): Pixels {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (view.getUint32(0) !== 0x89504e47) throw new Error("Not a PNG image");
  let at = 8;
  let width = 0;
  let height = 0;
  let depth = 0;
  let type = 0;
  let interlace = 0;
  let palette: Uint8Array | null = null;
  let alpha: Uint8Array | null = null;
  const data: Uint8Array[] = [];
  while (at < buf.length) {
    const len = view.getUint32(at);
    const kind = String.fromCharCode(buf[at + 4], buf[at + 5], buf[at + 6], buf[at + 7]);
    const body = buf.subarray(at + 8, at + 8 + len);
    if (kind === "IHDR") {
      width = view.getUint32(at + 8);
      height = view.getUint32(at + 12);
      depth = body[8];
      type = body[9];
      interlace = body[12];
    } else if (kind === "PLTE") palette = body;
    else if (kind === "tRNS") alpha = body;
    else if (kind === "IDAT") data.push(body);
    else if (kind === "IEND") break;
    at += 12 + len;
  }
  if (depth !== 8 || interlace) throw new Error(`Unsupported PNG (bit depth ${depth}, interlace ${interlace})`);
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[type];
  if (!channels) throw new Error(`Unsupported PNG colour type ${type}`);

  const raw = inflateSync(Buffer.concat(data));
  const stride = width * channels;
  const out = new Uint8Array(width * height * channels);
  // Undo the per-row filters (PNG spec section 9).
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1;
    const row = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? out[row + x - channels] : 0;
      const b = y > 0 ? out[row - stride + x] : 0;
      const c = x >= channels && y > 0 ? out[row - stride + x - channels] : 0;
      let v = raw[src + x];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      out[row + x] = v & 255;
    }
  }

  const index = type === 3 ? out : null;
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const o = i * 4;
    if (type === 6) rgba.set(out.subarray(i * 4, i * 4 + 4), o);
    else if (type === 2) {
      rgba.set(out.subarray(i * 3, i * 3 + 3), o);
      rgba[o + 3] = 255;
    } else if (type === 3) {
      const k = out[i];
      rgba[o] = palette?.[k * 3] ?? 0;
      rgba[o + 1] = palette?.[k * 3 + 1] ?? 0;
      rgba[o + 2] = palette?.[k * 3 + 2] ?? 0;
      rgba[o + 3] = alpha && k < alpha.length ? alpha[k] : 255;
    } else if (type === 0) {
      rgba[o] = rgba[o + 1] = rgba[o + 2] = out[i];
      rgba[o + 3] = 255;
    } else {
      rgba[o] = rgba[o + 1] = rgba[o + 2] = out[i * 2];
      rgba[o + 3] = out[i * 2 + 1];
    }
  }
  return { width, height, rgba, index };
}
