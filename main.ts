// makefun-news-image-20261121 — "The World in One Page"
// Sums up Saturday 21 November 2026 in one 1024x1024 broadsheet image.
// Node 22, standard library only. Draws everything procedurally:
// a single-stroke vector font, flat vector illustrations, a world map
// with numbered pins, and a hand-rolled PNG encoder. No network,
// no clock, no randomness — two runs write identical bytes.

import * as fs from "node:fs";
import * as path from "node:path";
import * as zlib from "node:zlib";

const W = 1024;
const H = 1024;

// ---------------------------------------------------------------- palette
type RGB = [number, number, number];
const PAPER: RGB = [247, 243, 232];
const INK: RGB = [26, 26, 40];
const RED: RGB = [178, 35, 27];
const NAVY: RGB = [30, 58, 95];
const GOLD: RGB = [176, 132, 38];
const TEAL: RGB = [18, 110, 105];
const GREY: RGB = [110, 108, 96];
const LIGHT: RGB = [233, 227, 208];
const MAPLAND: RGB = [216, 210, 189];
const MAPSEA: RGB = [207, 224, 232];
const WHITE: RGB = [255, 255, 255];
const SKY: RGB = [186, 214, 232];

// ------------------------------------------------------------------- CRC32
const CRC_TABLE: Uint32Array = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td), 0);
  return Buffer.concat([len, td, crc]);
}

function encodePNG(rgb: Uint8Array, w: number, h: number): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  // scanlines with filter byte 0
  const raw = Buffer.alloc(h * (1 + w * 3));
  for (let y = 0; y < h; y++) {
    raw[y * (1 + w * 3)] = 0;
    raw.set(rgb.subarray(y * w * 3, (y + 1) * w * 3), y * (1 + w * 3) + 1);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", idat),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

// ------------------------------------------------------------------ canvas
class Canvas {
  w: number;
  h: number;
  px: Uint8Array;
  constructor(w: number, h: number, bg: RGB) {
    this.w = w;
    this.h = h;
    this.px = new Uint8Array(w * h * 3);
    this.fillRect(0, 0, w, h, bg);
  }
  set(x: number, y: number, c: RGB): void {
    const ix = Math.round(x);
    const iy = Math.round(y);
    if (ix < 0 || iy < 0 || ix >= this.w || iy >= this.h) return;
    const o = (iy * this.w + ix) * 3;
    this.px[o] = c[0];
    this.px[o + 1] = c[1];
    this.px[o + 2] = c[2];
  }
  fillRect(x: number, y: number, w: number, h: number, c: RGB): void {
    const x0 = Math.max(0, Math.round(x));
    const y0 = Math.max(0, Math.round(y));
    const x1 = Math.min(this.w, Math.round(x + w));
    const y1 = Math.min(this.h, Math.round(y + h));
    for (let yy = y0; yy < y1; yy++) {
      let o = (yy * this.w + x0) * 3;
      for (let xx = x0; xx < x1; xx++) {
        this.px[o] = c[0];
        this.px[o + 1] = c[1];
        this.px[o + 2] = c[2];
        o += 3;
      }
    }
  }
  // filled disc
  disc(cx: number, cy: number, r: number, c: RGB): void {
    const rr = Math.max(0.5, r);
    const x0 = Math.max(0, Math.floor(cx - rr));
    const x1 = Math.min(this.w - 1, Math.ceil(cx + rr));
    const y0 = Math.max(0, Math.floor(cy - rr));
    const y1 = Math.min(this.h - 1, Math.ceil(cy + rr));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = x + 0.5 - cx;
        const dy = y + 0.5 - cy;
        if (dx * dx + dy * dy <= rr * rr) this.set(x, y, c);
      }
    }
  }
  // scanline fill of a simple polygon (even-odd)
  fillPoly(pts: Array<[number, number]>, c: RGB): void {
    if (pts.length < 3) return;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const p of pts) {
      if (p[1] < minY) minY = p[1];
      if (p[1] > maxY) maxY = p[1];
    }
    const y0 = Math.max(0, Math.floor(minY));
    const y1 = Math.min(this.h - 1, Math.ceil(maxY));
    for (let y = y0; y <= y1; y++) {
      const ys = y + 0.5;
      const xs: number[] = [];
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % pts.length];
        if ((a[1] <= ys && b[1] > ys) || (b[1] <= ys && a[1] > ys)) {
          const t = (ys - a[1]) / (b[1] - a[1]);
          xs.push(a[0] + t * (b[0] - a[0]));
        }
      }
      xs.sort((p, q) => p - q);
      for (let i = 0; i + 1 < xs.length; i += 2) {
        const xa = Math.max(0, Math.ceil(xs[i] - 0.5));
        const xb = Math.min(this.w - 1, Math.floor(xs[i + 1] - 0.5));
        for (let x = xa; x <= xb; x++) this.set(x, y, c);
      }
    }
  }
  // thick line segment with round caps
  thickLine(x0: number, y0: number, x1: number, y1: number, w: number, c: RGB): void {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len = Math.hypot(dx, dy);
    const hw = Math.max(0.5, w / 2);
    if (len < 0.01) {
      this.disc(x0, y0, hw, c);
      return;
    }
    const nx = (-dy / len) * hw;
    const ny = (dx / len) * hw;
    this.fillPoly(
      [
        [x0 + nx, y0 + ny],
        [x1 + nx, y1 + ny],
        [x1 - nx, y1 - ny],
        [x0 - nx, y0 - ny],
      ],
      c,
    );
    this.disc(x0, y0, hw, c);
    this.disc(x1, y1, hw, c);
  }
  // polyline of thick segments
  strokePoly(pts: Array<[number, number]>, w: number, c: RGB): void {
    for (let i = 0; i + 1 < pts.length; i++) {
      this.thickLine(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], w, c);
    }
  }
  hline(x: number, y: number, w: number, th: number, c: RGB): void {
    this.fillRect(x, y, w, th, c);
  }
  // circle outline
  circle(cx: number, cy: number, r: number, w: number, c: RGB): void {
    const steps = Math.max(24, Math.round(r * 6));
    const pts: Array<[number, number]> = [];
    for (let i = 0; i <= steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
    }
    this.strokePoly(pts, w, c);
  }
  // filled circle
  fillCircle(cx: number, cy: number, r: number, c: RGB): void {
    this.disc(cx, cy, r, c);
  }
}

// ------------------------------------------------------- single-stroke font
// Grid: cap height 12 units (y 0..12), baseline y=12, descenders to y=16.
// Format per glyph: "ADV:x1,y1 x2,y2|..." — strokes separated by "|".
const FONT: Record<string, string> = {
  A: "9:0,12 4,0 8,12|2,8 6,8",
  B: "8:0,12 0,0 6,0 8,2 8,4 6,6 0,6|0,6 6,6 8,8 8,10 6,12 0,12",
  C: "8:8,3 6,0 2,0 0,2 0,10 2,12 6,12 8,9",
  D: "8:0,12 0,0 6,0 8,2 8,10 6,12 0,12",
  E: "8:7,0 0,0 0,12 7,12|0,6 5,6",
  F: "8:0,12 0,0 7,0|0,6 5,6",
  G: "8:8,3 6,0 2,0 0,2 0,10 2,12 6,12 8,10 8,6 4,6",
  H: "8:0,12 0,0|8,12 8,0|0,6 8,6",
  I: "5:2,0 2,12|0,0 4,0|0,12 4,12",
  J: "8:6,0 6,9 4,12 1,12 0,10",
  K: "8:0,12 0,0|7,0 0,6|2,5 8,12",
  L: "8:0,0 0,12 7,12",
  M: "10:0,12 0,0 5,8 10,0 10,12",
  N: "9:0,12 0,0 9,12 9,0",
  O: "9:6,0 2,0 0,3 0,9 2,12 6,12 9,9 9,3 6,0",
  P: "8:0,12 0,0 6,0 8,2 8,5 6,6 0,6",
  Q: "9:6,0 2,0 0,3 0,9 2,12 6,12 9,9 9,3 6,0|5,8 9,12",
  R: "8:0,12 0,0 6,0 8,2 8,5 6,6 0,6|3,6 8,12",
  S: "8:8,2 6,0 2,0 0,2 0,4 8,8 8,10 6,12 2,12 0,10",
  T: "8:0,0 8,0|4,0 4,12",
  U: "9:0,0 0,9 2,12 6,12 9,9 9,0",
  V: "9:0,0 4,12 9,0",
  W: "11:0,0 2,12 5,4 8,12 11,0",
  X: "9:0,0 9,12|9,0 0,12",
  Y: "9:0,0 4,6 9,0|4,6 4,12",
  Z: "8:0,0 8,0 0,12 8,12",
  a: "8:1,12 1,6 3,4 6,4 7,6 7,12 1,12|7,4 7,12",
  b: "8:1,0 1,12|7,5 5,4 2,4 1,6 1,10 2,12 5,12 7,10 7,6",
  c: "8:7,6 5,4 2,4 1,6 1,10 2,12 5,12 7,10",
  d: "8:7,0 7,12|1,5 3,4 6,4 7,6 7,10 5,12 2,12 1,10 1,6",
  e: "8:7,9 6,4 3,4 1,6 1,9 3,12 6,12 7,11|1,8 7,8",
  f: "6:4,12 4,2 5,0 7,0|1,5 6,5",
  g: "8:7,5 5,4 2,4 1,6 1,9 2,12 5,12 7,10 7,5|7,10 6,16 2,16 1,14",
  h: "8:1,0 1,12|1,8 3,4 5,4 7,6 7,12",
  i: "4:2,4 2,12|2,0 2,1",
  j: "4:2,4 2,13 1,16 0,15|2,0 2,1",
  k: "8:1,0 1,12|6,4 1,8|2,7 7,12",
  l: "4:2,0 2,12",
  m: "11:1,12 1,4 3,4 4,6 4,12|4,7 6,4 8,4 10,6 10,12",
  n: "8:1,12 1,4 3,4 5,4 7,6 7,12",
  o: "8:5,4 2,4 1,6 1,10 2,12 5,12 7,10 7,6 5,4",
  p: "8:1,4 1,16|1,8 3,4 6,4 7,6 7,9 6,12 3,12 1,10",
  q: "8:7,4 7,16|1,5 3,4 6,4 7,6 7,10 5,12 2,12 1,10 1,6",
  r: "8:1,12 1,4 3,4 5,4 6,6|5,4 7,4",
  s: "8:7,6 5,4 2,4 1,6 1,7 7,10 7,11 5,12 2,12 1,10",
  t: "6:3,0 3,11 4,13 5,13|1,5 5,5",
  u: "8:1,4 1,10 2,12 5,12 7,10 7,4|7,4 7,12",
  v: "8:1,4 4,12 7,4",
  w: "11:1,4 3,12 5,6 7,12 9,4",
  x: "8:1,4 7,12|7,4 1,12",
  y: "8:1,4 4,11 7,4|4,11 4,14 2,16 1,15",
  z: "8:1,4 7,4 1,12 7,12",
  "0": "9:6,0 2,0 0,3 0,9 2,12 6,12 9,9 9,3 6,0",
  "1": "6:3,0 3,12|1,2 3,0|0,12 6,12",
  "2": "8:1,3 1,1 3,0 6,0 7,2 7,5 1,12 7,12",
  "3": "8:1,2 2,0 5,0 7,2 7,4 5,6 1,6|5,6 7,8 7,10 5,12 2,12 1,10",
  "4": "8:6,0 1,8 6,8|6,0 6,12",
  "5": "8:7,0 1,0 1,6 6,6 7,8 7,10 5,12 1,12 0,10",
  "6": "8:7,2 5,0 2,0 1,3 1,9 2,12 5,12 7,10 7,8 5,6 2,6 1,8",
  "7": "8:0,0 8,0 4,12",
  "8": "8:5,0 2,0 1,2 1,4 2,6 5,6 7,4 7,2 5,0|2,6 1,8 1,10 2,12 5,12 7,10 7,8 6,6",
  "9": "8:7,4 7,8 6,12 3,12 1,10 1,6 2,4 5,4 7,6",
  " ": "4:",
  ".": "4:2,11 2,12",
  ",": "4:2,11 2,12|2,12 1,14",
  ":": "4:2,4 2,5|2,9 2,10",
  ";": "4:2,4 2,5|2,9 2,10|2,10 1,13",
  "'": "4:2,0 2,2",
  '"': "8:2,0 2,2|6,0 6,2",
  "!": "4:2,0 2,9|2,11 2,12",
  "?": "8:1,3 2,0 5,0 7,2 7,4 6,6 4,6 4,8|4,11 4,12",
  "-": "8:1,6 7,6",
  "/": "8:6,12 2,0",
  "(": "6:5,0 3,3 3,9 5,12",
  ")": "6:1,0 3,3 3,9 1,12",
  "%": "11:3,1 1,2 1,4 3,5 4,4 4,2 3,1|9,8 8,9 8,11 9,12 10,11 10,9 9,8|2,12 9,0",
  $: "8:4,0 4,12|7,2 5,0 2,0 1,2 1,4 7,8 7,10 5,12 2,12 1,10",
  "&": "8:7,4 5,3 2,4 1,6 1,8 3,10 7,12|7,0 3,8 1,11",
  "+": "8:4,2 4,10|1,6 7,6",
  "=": "8:1,4 7,4|1,8 7,8",
  "*": "8:4,2 4,10|1,4 7,8|7,4 1,8",
  "\u2022": "6:2,5 4,5 4,7 2,7 2,5",
  "\u00b7": "4:2,5 2,6",
  "\u20ac": "8:7,3 5,0 2,0 1,2 1,10 2,12 5,12 7,9|0,4 6,4|0,8 6,8",
};

type Glyph = { adv: number; strokes: Array<Array<[number, number]>> };
const GLYPH_CACHE = new Map<string, Glyph>();
function glyph(ch: string): Glyph {
  const hit = GLYPH_CACHE.get(ch);
  if (hit) return hit;
  const raw = FONT[ch] ?? FONT["?"];
  const [advS, body] = raw.split(":");
  const adv = parseFloat(advS);
  const strokes: Array<Array<[number, number]>> = [];
  if (body) {
    for (const st of body.split("|")) {
      const pts: Array<[number, number]> = [];
      for (const p of st.split(" ")) {
        const [xs, ys] = p.split(",");
        pts.push([parseFloat(xs), parseFloat(ys)]);
      }
      if (pts.length) strokes.push(pts);
    }
  }
  const g = { adv, strokes };
  GLYPH_CACHE.set(ch, g);
  return g;
}

// normalise curly punctuation to the glyphs we carry
function norm(s: string): string {
  return s
    .replace(/[–—]/g, "-")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"');
}

// ------------------------------------------------------------ text engine
const TRACK = 0.6; // extra tracking, in font units

function textWidth(s: string, size: number): number {
  const sc = size / 12;
  let w = 0;
  for (const ch of norm(s)) w += (glyph(ch).adv + TRACK) * sc;
  return w - TRACK * sc;
}

function drawText(
  cv: Canvas,
  s: string,
  x: number,
  yTop: number,
  size: number,
  c: RGB,
  bold = false,
): number {
  const sc = size / 12;
  const w = bold ? Math.max(1, size / 5.5) : Math.max(1, size / 7);
  let cx = x;
  for (const ch of norm(s)) {
    const g = glyph(ch);
    for (const st of g.strokes) {
      const pts: Array<[number, number]> = st.map(([gx, gy]) => [
        cx + gx * sc,
        yTop + gy * sc,
      ]);
      cv.strokePoly(pts, w, c);
    }
    cx += (g.adv + TRACK) * sc;
  }
  return cx - x;
}

function drawTextCentred(
  cv: Canvas,
  s: string,
  cx: number,
  yTop: number,
  size: number,
  c: RGB,
  bold = false,
): void {
  drawText(cv, s, cx - textWidth(s, size) / 2, yTop, size, c, bold);
}

function wrapText(s: string, maxW: number, size: number): string[] {
  const words = norm(s).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const wd of words) {
    const trial = cur ? cur + " " + wd : wd;
    if (textWidth(trial, size) <= maxW || !cur) cur = trial;
    else {
      lines.push(cur);
      cur = wd;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

function drawPara(
  cv: Canvas,
  s: string,
  x: number,
  yTop: number,
  maxW: number,
  size: number,
  c: RGB,
  lh: number,
  bold = false,
): number {
  const lines = wrapText(s, maxW, size);
  let y = yTop;
  for (const ln of lines) {
    drawText(cv, ln, x, y, size, c, bold);
    y += lh;
  }
  return y;
}

// ------------------------------------------------------------------- data
// All 37 stories verified against live wires on Sat 21 Nov 2026 (02:00 UTC).
// Friday's late events are shown as follow-ups and dated "Friday" in their
// own text; Thursday's stories are listed in the DATE CHECK, not the page.
type Story = {
  n: number;
  place: string;
  beat: string;
  head: string;
  body: string;
  src: string;
  region: string;
  art: string;
  lat: number;
  lon: number;
  tag?: string;
};

const HEROES: Story[] = [
  {
    n: 1, place: "WARSAW", beat: "NATO", region: "EUROPE", art: "nato",
    lat: 52.2, lon: 21.0,
    head: "NATO chief in Warsaw after missiles hit Poland",
    body: "Mark Rutte visits today after two Russian missiles and a drone crashed in south-east Poland on Friday. Warsaw calls it a deliberate provocation and seeks more NATO forces.",
    src: "AP",
  },
  {
    n: 2, place: "ANTALYA", beat: "CLIMATE", region: "EUROPE", art: "cop",
    lat: 36.9, lon: 30.7,
    head: "COP31 spills into Saturday in fossil-fuel fight",
    body: "Talks run overtime after the draft drops the words \u201cfossil fuels\u201d. France and Panama lead a bloc demanding a stronger deal.",
    src: "UN News / AP",
  },
  {
    n: 3, place: "RIYADH", beat: "GULF", region: "MIDDLE EAST", art: "riyadh",
    lat: 24.7, lon: 46.7,
    head: "Riyadh intercepts fresh Houthi missiles",
    body: "The Arab coalition confirms debris and damage in Riyadh after an intercept, and says it downed more missiles in the south.",
    src: "Arab coalition", tag: "REPORTED",
  },
];

const CARDS: Story[] = [
  {
    n: 4, place: "NEW YORK", beat: "MARKETS", region: "AMERICAS", art: "chart",
    lat: 40.7, lon: -74.0,
    head: "AI rout erases $4 trillion in a week",
    body: "The S&P 500 fell 3.7% into correction; the Nasdaq sank 5.3%.",
    src: "WSJ",
  },
  {
    n: 5, place: "ODISHA", beat: "WEATHER", region: "ASIA", art: "cyclone",
    lat: 20.0, lon: 85.0,
    head: "Akvan's rains soak Bengal",
    body: "Rain soaks south Bengal into Saturday; 300,000 evacuated.",
    src: "IMD",
  },
  {
    n: 6, place: "KYIV", beat: "WAR", region: "EUROPE", art: "blast",
    lat: 50.4, lon: 30.5,
    head: "Russia's huge barrage hits Kyiv",
    body: "400-plus drones and 110 missiles overnight; eight killed.",
    src: "AP",
  },
  {
    n: 7, place: "TALLINN", beat: "SECURITY", region: "EUROPE", art: "border",
    lat: 59.4, lon: 24.7,
    head: "Estonia to shut its Russia border",
    body: "Road crossings close from 1 December after suspected arson.",
    src: "Estonian govt",
  },
  {
    n: 8, place: "WASHINGTON", beat: "TECH", region: "AMERICAS", art: "chip",
    lat: 38.9, lon: -77.0,
    head: "US clears 900,000 AI chips for China",
    body: "Close to 900,000 AI chips cleared for China in six months.",
    src: "House committee",
  },
  {
    n: 9, place: "NEW DELHI", beat: "JUSTICE", region: "ASIA", art: "gavel",
    lat: 28.6, lon: 77.2,
    head: "19 years for Sikh murder plot",
    body: "Jailed over 19 years for a plot to kill a US Sikh leader.",
    src: "US court",
  },
  {
    n: 10, place: "NEW DELHI", beat: "RIGHTS", region: "ASIA", art: "scales",
    lat: 28.6, lon: 77.6,
    head: "US panel: India targets minorities",
    body: "A US panel says India targets minorities in voter rolls.",
    src: "USCIRF", tag: "REPORTED",
  },
  {
    n: 11, place: "JOHANNESBURG", beat: "CRIME", region: "AFRICA", art: "tape",
    lat: -26.2, lon: 28.0,
    head: "Murders fall, but 60 a day",
    body: "Murder rate falls, yet homicides still reach 60 a day.",
    src: "Stats SA",
  },
  {
    n: 12, place: "BAGHDAD", beat: "SECURITY", region: "MIDDLE EAST", art: "flag",
    lat: 33.3, lon: 44.4,
    head: "Iraqi forces retake Jurf al-Sakhar",
    body: "Troops move in after 12 years of Kataib Hezbollah rule.",
    src: "Iraqi forces",
  },
  {
    n: 13, place: "NEW YORK", beat: "CITY", region: "AMERICAS", art: "bars",
    lat: 40.7, lon: -73.9,
    head: "Mamdani vows to shut Rikers by 2032",
    body: "Mayor-elect plans to close the Rikers jail complex by 2032.",
    src: "City Hall",
  },
];

const BRIEFS: Array<{ n: number; place: string; text: string; src: string; region: string; tag?: string }> = [
  { n: 14, place: "KRYVYI RIH", region: "EUROPE", text: "Russian strike kills two and injures 42, four children.", src: "Local officials" },
  { n: 15, place: "BRUSSELS", region: "EUROPE", text: "EU allocates \u20ac7.9bn to Ukraine in a lump sum.", src: "EU" },
  { n: 16, place: "LONDON", region: "EUROPE", text: "UK and EU sign deals on food trade, carbon markets and youth mobility.", src: "UK govt" },
  { n: 17, place: "WASHINGTON", region: "AMERICAS", text: "Trump pardons baseball star Pete Rose posthumously.", src: "White House" },
  { n: 18, place: "WASHINGTON", region: "AMERICAS", text: "US offers Ukraine NATO membership for land, a report says.", src: "Report", tag: "REPORTED" },
  { n: 19, place: "WASHINGTON", region: "AMERICAS", text: "US sanctions the Comancheros and the \u2018Ndrangheta crime groups.", src: "US Treasury" },
  { n: 20, place: "WASHINGTON", region: "AMERICAS", text: "US sanctions four Iranians over oil revenues.", src: "US Treasury" },
  { n: 21, place: "FRANKFURT", region: "EUROPE", text: "Boone and Brunnermeier enter the race for the ECB board.", src: "ECB" },
  { n: 22, place: "LONDON", region: "EUROPE", text: "UK pledges 1,000-plus drones for Ukraine.", src: "UK MoD" },
  { n: 23, place: "PARIS", region: "EUROPE", text: "France calls for a UN Security Council meeting over the Kyiv strikes.", src: "France" },
  { n: 24, place: "MURMANSK", region: "EUROPE", text: "Ukrainian drones strike an oil terminal in the Kola region.", src: "Reports", tag: "CLAIM" },
  { n: 25, place: "NEW DELHI", region: "ASIA", text: "Modi calls for dialogue and trust at the SCO civilisational conference.", src: "India govt" },
  { n: 26, place: "NEW DELHI", region: "ASIA", text: "A Pakistani minister arrives in India for the SCO dialogue.", src: "Reports" },
  { n: 27, place: "DAKAR", region: "AFRICA", text: "Senegal's president passes the budget by decree after rejection.", src: "Senegal govt" },
  { n: 28, place: "AMSTERDAM", region: "EUROPE", text: "Tata Steel faces a criminal trial in the Netherlands over air pollution.", src: "Dutch prosecutors" },
  { n: 29, place: "SACRAMENTO", region: "AMERICAS", text: "California probes whether China got Nvidia tech unlawfully.", src: "California" },
  { n: 30, place: "WASHINGTON", region: "AMERICAS", text: "Trump says a nuclear arms deal with China and Russia is hard.", src: "Trump" },
  { n: 31, place: "SEOUL", region: "ASIA", text: "Trump says he is too busy to see Kim Jong-un on his Asia trip.", src: "Trump" },
  { n: 32, place: "WELLINGTON", region: "OCEANIA", text: "India resume day three at 159 for 1 after Nicholls' unbeaten 175.", src: "BCCI" },
  { n: 33, place: "ANKARA", region: "EUROPE", text: "Turkey applauds the world court's Myanmar genocide ruling.", src: "Turkey" },
  { n: 34, place: "TEHRAN", region: "MIDDLE EAST", text: "Iran rejects US arms claims, citing the discredited Iraq WMD claims.", src: "Iran" },
  { n: 35, place: "PODGORICA", region: "EUROPE", text: "Montenegro rejects land concessions to Croatia amid an EU membership row.", src: "Montenegro" },
  { n: 36, place: "BRUSSELS", region: "EUROPE", text: "Hungary lifts its block on the last two EU accession chapters.", src: "EU" },
  { n: 37, place: "ADEN", region: "MIDDLE EAST", text: "Yemen: Houthis turned Hodeidah ports into weapons sites.", src: "Yemen govt" },
];

const STATS: Array<[string, string]> = [
  ["$4tn", "wiped off tech stocks this week"],
  ["400+", "drones in Russia's overnight barrage"],
  ["300,000", "evacuated ahead of Cyclone Akvan"],
  ["900,000", "AI chips cleared for China in six months"],
  ["209mm", "rain in a day at Patrapur, Odisha"],
  ["175*", "Nicholls' unbeaten knock in Wellington"],
];

const DATE_CHECK: string =
  "Shenzhen Trump-Xi-Putin summit (Thu 19 Nov) \u00b7 World Court: Myanmar genocide (Thu 19 Nov) \u00b7 Anthropic $81.3bn IPO (Thu 19 Nov) \u00b7 GTA VI launch (Thu 19 Nov) \u00b7 JPMorgan, Visa and Mastercard breaches (Thu 19 Nov) \u00b7 Fed minutes (Wed 18 Nov) \u00b7 Van Gogh $190.4m sale (Wed 18 Nov) \u00b7 Voyager 1 one light-day out (Wed 18 Nov) \u00b7 Pew: Islam largest faith by 2035 (not that day's news).";

const REGIONS: Array<[string, RGB]> = [
  ["EUROPE", NAVY],
  ["AMERICAS", RED],
  ["ASIA", TEAL],
  ["MIDDLE EAST", GOLD],
  ["AFRICA", [122, 84, 40]],
  ["OCEANIA", [90, 90, 120]],
];

// ------------------------------------------------------------------ art
// Each illustration draws flat vector shapes inside its box (x, y, w, h).
function artNato(cv: Canvas, x: number, y: number, w: number, h: number): void {
  cv.fillRect(x, y, w, h, SKY);
  // Polish flag on a pole, left
  const fx = x + 14;
  const fy = y + 8;
  cv.thickLine(fx, fy, fx, y + h - 8, 2, INK);
  cv.fillRect(fx, fy, 34, 9, WHITE);
  cv.fillRect(fx, fy + 9, 34, 9, RED);
  // NATO compass star, centre
  const cx = x + w * 0.55;
  const cy = y + h * 0.52;
  const r = Math.min(w, h) * 0.26;
  const star: Array<[number, number]> = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 - Math.PI / 2;
    const rr = i % 2 === 0 ? r : r * 0.28;
    star.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
  }
  cv.fillPoly(star, NAVY);
  cv.fillCircle(cx, cy, r * 0.18, WHITE);
  // missile trail, right
  cv.thickLine(x + w - 46, y + 12, x + w - 12, y + h - 22, 2, GREY);
  cv.fillPoly(
    [
      [x + w - 12, y + h - 26],
      [x + w - 4, y + h - 18],
      [x + w - 14, y + h - 14],
    ],
    INK,
  );
  cv.hline(x, y + h - 6, w, 2, [120, 130, 110]);
}

function artCop(cv: Canvas, x: number, y: number, w: number, h: number): void {
  cv.fillRect(x, y, w, h, [214, 232, 214]);
  // globe
  const cx = x + w * 0.28;
  const cy = y + h * 0.5;
  const r = h * 0.36;
  cv.fillCircle(cx, cy, r, [70, 130, 180]);
  cv.fillPoly(
    [
      [cx - r * 0.6, cy - r * 0.4],
      [cx - r * 0.1, cy - r * 0.55],
      [cx + r * 0.2, cy - r * 0.2],
      [cx - r * 0.2, cy + r * 0.1],
      [cx - r * 0.7, cy + r * 0.1],
    ],
    [90, 170, 90],
  );
  cv.fillPoly(
    [
      [cx + r * 0.3, cy + r * 0.3],
      [cx + r * 0.7, cy + r * 0.4],
      [cx + r * 0.5, cy + r * 0.8],
      [cx + r * 0.1, cy + r * 0.6],
    ],
    [90, 170, 90],
  );
  cv.circle(cx, cy, r, 2, NAVY);
  // sun
  const sx = x + w * 0.62;
  const sy = y + h * 0.3;
  cv.fillCircle(sx, sy, 9, GOLD);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    cv.thickLine(
      sx + Math.cos(a) * 12, sy + Math.sin(a) * 12,
      sx + Math.cos(a) * 17, sy + Math.sin(a) * 17, 2, GOLD,
    );
  }
  // rising bars: 35 by 35
  const bx = x + w * 0.6;
  const by = y + h - 12;
  const bh = [10, 17, 24];
  for (let i = 0; i < 3; i++) {
    cv.fillRect(bx + i * 16, by - bh[i], 11, bh[i], TEAL);
  }
  drawText(cv, "35", bx + 52, by - 26, 13, TEAL, true);
}

function artRiyadh(cv: Canvas, x: number, y: number, w: number, h: number): void {
  cv.fillRect(x, y, w, h, [250, 226, 200]);
  // skyline
  const base = y + h - 6;
  const bw = [26, 20, 30, 18, 24];
  let bx = x + 8;
  for (let i = 0; i < bw.length; i++) {
    const bh = [34, 46, 30, 40, 26][i];
    cv.fillRect(bx, base - bh, bw[i], bh, INK);
    bx += bw[i] + 4;
  }
  // tall tower with spire
  const tx = x + w - 58;
  cv.fillRect(tx, y + 8, 16, base - y - 8, NAVY);
  cv.thickLine(tx + 8, y + 8, tx + 8, y + 2, 2, NAVY);
  // intercept burst
  const cx = x + w * 0.52;
  const cy = y + 16;
  const star: Array<[number, number]> = [];
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const rr = i % 2 === 0 ? 13 : 5;
    star.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
  }
  cv.fillPoly(star, [230, 120, 30]);
  cv.fillCircle(cx, cy, 4, RED);
  // missile trail
  cv.thickLine(cx + 16, cy + 12, cx + 44, cy + 34, 2, GREY);
  cv.hline(x, base, w, 2, INK);
}

function artChart(cv: Canvas, x: number, y: number, w: number, h: number): void {
  cv.fillRect(x, y, w, h, [238, 232, 220]);
  const ax = x + 8;
  const ay = y + h - 8;
  cv.thickLine(ax, y + 6, ax, ay, 2, INK);
  cv.thickLine(ax, ay, x + w - 6, ay, 2, INK);
  // falling line
  const pts: Array<[number, number]> = [];
  const n = 7;
  for (let i = 0; i < n; i++) {
    pts.push([ax + 6 + (i * (w - 22)) / (n - 1), y + 8 + i * ((h - 22) / (n - 1))]);
  }
  cv.strokePoly(pts, 3, RED);
  for (const p of pts) cv.fillCircle(p[0], p[1], 2, RED);
  drawText(cv, "-5.3%", x + w - 44, y + 4, 11, RED, true);
}

function artCyclone(cv: Canvas, x: number, y: number, w: number, h: number): void {
  cv.fillRect(x, y, w, h, [210, 226, 240]);
  const cx = x + w / 2;
  const cy = y + h / 2;
  for (let k = 0; k < 3; k++) {
    const r = 5 + k * 5;
    const pts: Array<[number, number]> = [];
    for (let i = 0; i <= 20; i++) {
      const a = (i / 20) * Math.PI * 1.6 + k * 0.5;
      pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r * 0.85]);
    }
    cv.strokePoly(pts, 2, TEAL);
  }
  cv.fillCircle(cx, cy, 3, RED);
  // rain
  for (let i = 0; i < 5; i++) {
    const rx = x + 8 + i * 9;
    cv.thickLine(rx, y + h - 10, rx - 2, y + h - 4, 2, NAVY);
  }
}

function artBlast(cv: Canvas, x: number, y: number, w: number, h: number): void {
  cv.fillRect(x, y, w, h, [240, 228, 210]);
  // building
  cv.fillRect(x + 8, y + 12, 30, h - 18, GREY);
  cv.fillRect(x + 8, y + 8, 30, 4, INK);
  for (let i = 0; i < 3; i++) {
    cv.fillRect(x + 13, y + 15 + i * 7, 20, 4, LIGHT);
  }
  // explosion
  const cx = x + w * 0.66;
  const cy = y + h * 0.45;
  const star: Array<[number, number]> = [];
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const rr = i % 2 === 0 ? 14 : 6;
    star.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
  }
  cv.fillPoly(star, [235, 140, 40]);
  cv.fillCircle(cx, cy, 5, RED);
  // smoke
  cv.fillCircle(x + w - 14, y + 8, 4, GREY);
  cv.fillCircle(x + w - 22, y + 5, 3, GREY);
}

function artBorder(cv: Canvas, x: number, y: number, w: number, h: number): void {
  cv.fillRect(x, y, w, h, [232, 236, 228]);
  // fence posts
  for (let i = 0; i < 5; i++) {
    cv.fillRect(x + 10 + i * 14, y + 8, 3, h - 14, INK);
  }
  cv.thickLine(x + 6, y + 12, x + w - 6, y + 12, 2, INK);
  // striped barrier
  const by = y + h - 12;
  for (let i = 0; i < 8; i++) {
    cv.fillRect(x + 8 + i * 9, by, 9, 6, i % 2 === 0 ? RED : WHITE);
  }
  cv.hline(x, by - 2, w, 1, INK);
}

function artChip(cv: Canvas, x: number, y: number, w: number, h: number): void {
  cv.fillRect(x, y, w, h, [226, 232, 238]);
  const cx = x + w / 2;
  const cy = y + h / 2;
  cv.fillRect(cx - 14, cy - 11, 28, 22, INK);
  cv.fillRect(cx - 8, cy - 5, 16, 10, TEAL);
  for (let i = -2; i <= 2; i++) {
    cv.thickLine(cx + i * 6, cy - 16, cx + i * 6, cy - 11, 2, INK);
    cv.thickLine(cx + i * 6, cy + 11, cx + i * 6, cy + 16, 2, INK);
  }
  drawText(cv, "AI", cx - 7, cy - 4, 9, WHITE, true);
}

function artGavel(cv: Canvas, x: number, y: number, w: number, h: number): void {
  cv.fillRect(x, y, w, h, [238, 230, 214]);
  cv.thickLine(x + 12, y + h - 10, x + w - 22, y + 8, 4, [120, 80, 40]);
  cv.fillRect(x + w - 34, y + 4, 22, 10, INK);
  cv.fillRect(x + w - 30, y + 14, 14, 6, INK);
  cv.fillRect(x + 8, y + h - 12, 30, 5, NAVY);
  drawText(cv, "19", x + 12, y + h - 11, 9, WHITE, true);
}

function artScales(cv: Canvas, x: number, y: number, w: number, h: number): void {
  cv.fillRect(x, y, w, h, [236, 232, 222]);
  const cx = x + w / 2;
  cv.thickLine(cx, y + 4, cx, y + h - 8, 2, INK);
  cv.thickLine(cx - 16, y + 8, cx + 16, y + 8, 2, INK);
  for (const s of [-1, 1]) {
    const px = cx + s * 16;
    cv.thickLine(px, y + 8, px, y + 18, 1, INK);
    cv.fillPoly(
      [
        [px - 8, y + 18],
        [px + 8, y + 18],
        [px, y + 26],
      ],
      GOLD,
    );
  }
  cv.fillRect(cx - 12, y + h - 8, 24, 4, INK);
}

function artTape(cv: Canvas, x: number, y: number, w: number, h: number): void {
  cv.fillRect(x, y, w, h, [240, 238, 226]);
  const ty = y + h / 2 - 5;
  cv.fillRect(x + 4, ty, w - 8, 10, [235, 200, 40]);
  for (let i = 0; i < 7; i++) {
    const sx = x + 8 + i * 11;
    cv.fillPoly(
      [
        [sx, ty],
        [sx + 5, ty],
        [sx + 1, ty + 10],
        [sx - 4, ty + 10],
      ],
      INK,
    );
  }
  drawText(cv, "60", x + w - 26, y + 4, 12, RED, true);
}

function artFlag(cv: Canvas, x: number, y: number, w: number, h: number): void {
  cv.fillRect(x, y, w, h, [234, 230, 214]);
  const fx = x + 10;
  cv.thickLine(fx, y + 6, fx, y + h - 6, 2, INK);
  cv.fillRect(fx, y + 6, 34, 6, RED);
  cv.fillRect(fx, y + 12, 34, 6, WHITE);
  cv.fillRect(fx, y + 18, 34, 6, INK);
  cv.fillRect(x + w - 30, y + h - 16, 22, 10, NAVY);
  cv.fillRect(x + w - 34, y + h - 22, 30, 6, GREY);
}

function artBars(cv: Canvas, x: number, y: number, w: number, h: number): void {
  cv.fillRect(x, y, w, h, [228, 228, 226]);
  for (let i = 0; i < 6; i++) {
    cv.fillRect(x + 10 + i * 11, y + 5, 4, h - 10, INK);
  }
  cv.fillRect(x + 6, y + 3, w - 12, 3, INK);
  cv.fillRect(x + 6, y + h - 6, w - 12, 3, INK);
  drawText(cv, "2032", x + w - 34, y + h - 16, 9, WHITE, true);
}

const ART: Record<string, (cv: Canvas, x: number, y: number, w: number, h: number) => void> = {
  nato: artNato,
  cop: artCop,
  riyadh: artRiyadh,
  chart: artChart,
  cyclone: artCyclone,
  blast: artBlast,
  border: artBorder,
  chip: artChip,
  gavel: artGavel,
  scales: artScales,
  tape: artTape,
  flag: artFlag,
  bars: artBars,
};

// -------------------------------------------------------------------- map
// Very rough continent outlines (lon, lat), equirectangular.
const CONTINENTS: Array<Array<[number, number]>> = [
  [[-168, 66], [-140, 70], [-125, 72], [-110, 73], [-95, 80], [-85, 80], [-75, 72], [-65, 60], [-55, 52], [-60, 45], [-70, 42], [-75, 35], [-80, 32], [-85, 30], [-90, 21], [-97, 16], [-105, 20], [-115, 28], [-125, 40], [-125, 49], [-140, 60], [-155, 58], [-165, 60]],
  [[-80, 10], [-75, 5], [-60, 0], [-50, -5], [-35, -8], [-40, -20], [-50, -30], [-60, -38], [-65, -45], [-70, -52], [-73, -40], [-72, -20], [-77, -12], [-80, -5]],
  [[-17, 15], [-10, 30], [0, 36], [10, 37], [20, 32], [30, 31], [35, 28], [43, 12], [51, 11], [48, 0], [40, -10], [35, -20], [30, -30], [20, -35], [15, -27], [12, -18], [9, -2], [9, 4], [-8, 5], [-13, 8], [-17, 12]],
  [[-10, 36], [-9, 43], [-2, 48], [-5, 50], [0, 51], [5, 53], [8, 55], [10, 57], [12, 56], [18, 56], [21, 55], [23, 58], [28, 60], [30, 62], [25, 65], [20, 68], [15, 70], [25, 71], [30, 70], [35, 68], [40, 66], [45, 68], [50, 69], [55, 68], [60, 69], [65, 68], [68, 66], [60, 60], [55, 55], [50, 52], [45, 50], [40, 48], [38, 46], [35, 45], [30, 46], [28, 44], [23, 40], [19, 42], [15, 44], [12, 44], [8, 44], [3, 42], [0, 40], [-2, 37], [-6, 36], [-9, 37]],
  [[30, 70], [40, 68], [50, 69], [60, 70], [70, 72], [80, 73], [90, 75], [100, 77], [110, 76], [120, 73], [130, 72], [140, 72], [150, 70], [160, 66], [170, 67], [178, 65], [170, 60], [162, 58], [158, 52], [150, 60], [142, 55], [140, 50], [135, 43], [130, 42], [127, 40], [122, 38], [120, 32], [115, 25], [110, 20], [108, 12], [105, 8], [100, 6], [95, 15], [92, 20], [88, 22], [85, 18], [80, 10], [77, 8], [75, 12], [72, 20], [68, 23], [65, 25], [60, 25], [57, 26], [54, 27], [52, 29], [50, 30], [48, 30], [44, 29], [42, 30], [40, 32], [38, 36], [36, 36], [33, 37], [30, 36], [28, 38], [27, 40], [30, 42], [32, 44], [35, 46], [38, 48], [40, 50], [42, 52], [45, 55], [48, 58], [50, 60], [55, 62], [58, 65]],
  [[113, -22], [114, -30], [115, -35], [120, -34], [125, -32], [130, -32], [135, -35], [138, -35], [140, -38], [145, -38], [150, -37], [153, -32], [153, -27], [150, -22], [146, -19], [142, -15], [142, -11], [137, -12], [135, -12], [132, -12], [130, -13], [126, -14], [122, -17], [118, -20]],
];

// ----------------------------------------------------------------- layout
const MX = 16; // margin
const CW = 992; // content width

function regionCount(region: string): number {
  let n = 0;
  for (const s of [...HEROES, ...CARDS]) if (s.region === region) n++;
  for (const b of BRIEFS) if (b.region === region) n++;
  return n;
}

function drawMasthead(cv: Canvas): void {
  cv.hline(MX, 8, CW, 3, RED);
  drawTextCentred(cv, "THE WORLD IN ONE PAGE", W / 2, 8, 12, NAVY, true);
  drawTextCentred(cv, "Saturday 21 November 2026", W / 2, 28, 34, INK, true);
  drawTextCentred(
    cv,
    "37 STORIES \u00b7 6 REGIONS \u00b7 ONE PAGE",
    W / 2,
    78,
    11,
    GREY,
    true,
  );
  cv.hline(MX, 92, CW, 2, RED);
}

function drawKicker(cv: Canvas): void {
  const s =
    "NATO chief in Warsaw after missiles hit Poland \u00b7 COP31 spills into Saturday \u00b7 Riyadh intercepts fresh Houthi missiles";
  const lines = wrapText(s, CW - 40, 14);
  let y = 98;
  for (const ln of lines) {
    drawTextCentred(cv, ln, W / 2, y, 14, RED, true);
    y += 17;
  }
}

function drawStats(cv: Canvas): void {
  const y0 = 136;
  const cell = CW / STATS.length;
  for (let i = 0; i < STATS.length; i++) {
    const cx = MX + cell * i + cell / 2;
    if (i > 0) cv.fillRect(Math.round(MX + cell * i), y0 + 4, 1, 44, LIGHT);
    drawTextCentred(cv, STATS[i][0], cx, y0, 24, NAVY, true);
    const lab = wrapText(STATS[i][1], cell - 16, 10);
    let ly = y0 + 28;
    for (const ln of lab) {
      drawTextCentred(cv, ln, cx, ly, 10, INK);
      ly += 12;
    }
  }
}

function drawRegions(cv: Canvas): void {
  const y0 = 192;
  const cell = CW / REGIONS.length;
  for (let i = 0; i < REGIONS.length; i++) {
    const [name, col] = REGIONS[i];
    const x = MX + cell * i;
    cv.fillRect(x, y0, cell - 2, 3, col);
    const label = name + " " + regionCount(name);
    drawTextCentred(cv, label, x + (cell - 2) / 2, y0 + 7, 11, INK, true);
  }
}

function drawHero(cv: Canvas, s: Story, x: number, y0: number, w: number): void {
  ART[s.art](cv, x, y0, w, 50);
  const kick = s.place + " \u00b7 " + s.beat + " — " + s.src + (s.tag ? " \u00b7 " + s.tag : "");
  drawText(cv, kick, x, y0 + 56, 10, RED, true);
  const headLines = wrapText(s.head, w, 17);
  let y = y0 + 70;
  for (const ln of headLines.slice(0, 2)) {
    drawText(cv, ln, x, y, 17, INK, true);
    y += 20;
  }
  const body = wrapText(s.body, w, 10);
  y += 2;
  for (const ln of body.slice(0, 3)) {
    drawText(cv, ln, x, y, 10, INK);
    y += 13;
  }
}

function drawCard(cv: Canvas, s: Story, x: number, y0: number, w: number): void {
  ART[s.art](cv, x, y0, w, 26);
  const kick = s.place + " \u00b7 " + s.beat + " — " + s.src + (s.tag ? " \u00b7 " + s.tag : "");
  drawText(cv, kick, x, y0 + 30, 8, RED, true);
  const headLines = wrapText(s.head, w, 12);
  let y = y0 + 41;
  for (const ln of headLines.slice(0, 2)) {
    drawText(cv, ln, x, y, 12, INK, true);
    y += 14;
  }
  const body = wrapText(s.body, w, 9);
  for (const ln of body.slice(0, 2)) {
    drawText(cv, ln, x, y, 9, INK);
    y += 11;
  }
}

function drawMap(cv: Canvas, x: number, y0: number, w: number, h: number): void {
  cv.fillRect(x, y0, w, h, MAPSEA);
  const lonToX = (lon: number): number => x + ((lon + 180) / 360) * w;
  const latToY = (lat: number): number => y0 + ((80 - lat) / 140) * h;
  for (const poly of CONTINENTS) {
    const pts: Array<[number, number]> = poly.map(([lo, la]) => [lonToX(lo), latToY(la)]);
    cv.fillPoly(pts, MAPLAND);
  }
  // pins for stories 1-13 (small offsets where two share a city)
  const off: Record<number, [number, number]> = { 1: [-8, -4], 2: [7, 6], 6: [8, -4], 7: [0, -9], 10: [7, 5], 12: [8, -6], 13: [-7, 6] };
  for (const s of [...HEROES, ...CARDS]) {
    const [dx, dy] = off[s.n] ?? [0, 0];
    const px = lonToX(s.lon) + dx;
    const py = latToY(s.lat) + dy;
    cv.fillCircle(px, py, 7, RED);
    cv.circle(px, py, 7, 1, WHITE);
    const num = String(s.n);
    drawText(cv, num, px - textWidth(num, 9) / 2, py - 5, 9, WHITE, true);
  }
}

function drawBriefs(cv: Canvas, x: number, y0: number, w: number): void {
  drawText(cv, "ALSO IN THE NEWS", x, y0, 11, INK, true);
  let y = y0 + 18;
  for (const b of BRIEFS) {
    const tag = b.tag ? " \u00b7 " + b.tag : "";
    const line = b.n + ". " + b.place + " — " + b.text + " (" + b.src + ")" + tag;
    drawText(cv, line, x, y, 9, INK);
    y += 11;
  }
}

function drawDateCheck(cv: Canvas): void {
  const y0 = 874;
  cv.fillRect(MX, y0, CW, 80, [253, 244, 230]);
  cv.fillRect(MX, y0, CW, 2, RED);
  cv.fillRect(MX, y0 + 78, CW, 2, RED);
  cv.fillRect(MX, y0, 2, 80, RED);
  cv.fillRect(MX + CW - 2, y0, 2, 80, RED);
  drawText(cv, "DATE CHECK — LEFT OUT ON PURPOSE, BECAUSE THEY BROKE BEFORE SATURDAY:", MX + 10, y0 + 7, 11, RED, true);
  drawPara(cv, DATE_CHECK, MX + 10, y0 + 23, CW - 20, 10, INK, 13);
}

function drawFooter(cv: Canvas): void {
  drawText(
    cv,
    "Every story is dated in its own text. Saturday's news, as reported so far today.",
    MX,
    962,
    10,
    INK,
  );
  drawText(
    cv,
    "Sources: AP \u00b7 Reuters \u00b7 WSJ \u00b7 UN News \u00b7 IMD \u00b7 BCCI \u00b7 and the wires. Drawn by a program; no photographs.",
    MX,
    978,
    9,
    GREY,
  );
}

function drawPage(): Canvas {
  const cv = new Canvas(W, H, PAPER);
  drawMasthead(cv);
  drawKicker(cv);
  drawStats(cv);
  drawRegions(cv);
  // heroes
  const hw = 320;
  for (let i = 0; i < HEROES.length; i++) {
    const x = MX + i * (hw + 16);
    if (i > 0) cv.fillRect(x - 8, 218, 1, 154, LIGHT);
    drawHero(cv, HEROES[i], x, 218, hw);
  }
  cv.hline(MX, 378, CW, 1, GREY);
  // cards, 5 across x 2 rows
  const cw2 = 192;
  for (let r = 0; r < 2; r++) {
    const y0 = 384 + r * 96;
    for (let c = 0; c < 5; c++) {
      const x = MX + c * (cw2 + 8);
      if (c > 0) cv.fillRect(x - 4, y0, 1, 92, LIGHT);
      drawCard(cv, CARDS[r * 5 + c], x, y0, cw2);
    }
  }
  cv.hline(MX, 578, CW, 1, GREY);
  // map + legend, left column
  drawText(cv, "WHERE IT HAPPENED", MX, 584, 11, INK, true);
  drawMap(cv, MX, 600, 284, 120);
  drawText(cv, "Red pins = stories 1-13. Positions approximate.", MX, 727, 9, GREY);
  drawText(cv, "HOW SURE ARE WE?", MX, 747, 10, INK, true);
  drawText(cv, "REPORTED: named sources.", MX, 761, 9, INK);
  drawText(cv, "CLAIM: one side's account, unverified.", MX, 773, 9, INK);
  drawText(cv, "FORECAST: poll, draft or schedule.", MX, 785, 9, INK);
  drawPara(
    cv,
    "Reads at three sizes: the date and leads at thumbnail, the panels at half size, all 37 stories at full size.",
    MX,
    802,
    284,
    9,
    GREY,
    11,
  );
  // briefs, right column
  drawBriefs(cv, 316, 584, 692);
  drawDateCheck(cv);
  drawFooter(cv);
  return cv;
}

// -------------------------------------------------------------------- main
function main(): void {
  const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? "/output";
  fs.mkdirSync(outDir, { recursive: true });
  const cv = drawPage();
  const png = encodePNG(cv.px, W, H);
  fs.writeFileSync(path.join(outDir, "entry.png"), png);
  console.log("wrote entry.png: " + png.length + " bytes, " + W + "x" + H);
}

main();
