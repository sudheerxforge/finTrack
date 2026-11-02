// Draws the FINTRACK app icon and writes the Android launcher PNGs (legacy,
// round, adaptive foreground/background) plus web icons. Pure Node, no deps.
//
//   node scripts/generate-icons.js            -> applies the default style
//   node scripts/generate-icons.js neon       -> applies a specific style
//   node scripts/generate-icons.js --sheet    -> only writes a comparison sheet
//
// Styles: aurora, neon, royal
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const RES = path.join(__dirname, '..', 'android', 'app', 'src', 'main', 'res');
const WEB = path.join(__dirname, '..', '..', 'web');
const ASSETS = path.join(__dirname, '..', 'src', 'assets');
const DEFAULT_STYLE = 'aurora';

// ---- tiny PNG encoder ----
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(td) >>> 0);
  return Buffer.concat([len, td, crc]);
}
function encodePng(w, h, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---- colour helpers ----
const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255);
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * Math.min(1, Math.max(0, t)));
function over(dst, c, a) {
  const A = a + dst[3] * (1 - a);
  if (A <= 0) return [0, 0, 0, 0];
  return [
    (c[0] * a + dst[0] * dst[3] * (1 - a)) / A,
    (c[1] * a + dst[1] * dst[3] * (1 - a)) / A,
    (c[2] * a + dst[2] * dst[3] * (1 - a)) / A,
    A,
  ];
}
const clamp01 = v => Math.min(1, Math.max(0, v));
const smooth = (e0, e1, x) => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};
const WHITE = [1, 1, 1];

// ---- the rupee sign (₹) as a stroked path (signed distance to polylines) ----
// Two bars on top, a round bowl on the right, and a diagonal leg. Sized by R
// (R = 0.088 gives the same overall size the old symbol had).
function makeGlyph({ R, stroke, cx = 0.5, cy = 0.5 }) {
  const k = R / 0.088; // scale
  const lw = stroke * 0.82; // the rupee has more horizontal strokes, so keep it a little lighter
  const X = v => cx + v * k;
  const Y = v => cy - 0.014 * k + v * k; // optically centre the glyph
  const top = -0.168;
  const rb = 0.077; // bowl radius
  const bx = -0.012; // bowl centre x
  const by = top + rb;
  const polys = [];
  // two bars
  polys.push([[X(-0.135), Y(top)], [X(0.135), Y(top)]]);
  polys.push([[X(-0.135), Y(by)], [X(0.135), Y(by)]]);
  // bowl: from the top bar, clockwise around the right side, back to the left at the bottom
  const bowl = [];
  for (let i = 0; i <= 40; i++) {
    const a = ((-90 + (180 * i) / 40) * Math.PI) / 180;
    bowl.push([X(bx + rb * Math.cos(a)), Y(by + rb * Math.sin(a))]);
  }
  bowl.push([X(-0.105), Y(by + rb)]);
  polys.push(bowl);
  // diagonal leg from the bottom of the bowl to the lower right
  polys.push([[X(-0.105), Y(by + rb)], [X(0.085), Y(0.205)]]);
  const seg = (px, py, a, b) => {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const t = clamp01(((px - a[0]) * dx + (py - a[1]) * dy) / (dx * dx + dy * dy || 1));
    return Math.hypot(px - (a[0] + t * dx), py - (a[1] + t * dy));
  };
  return (x, y) => {
    let best = Infinity;
    for (const p of polys) {
      for (let i = 0; i < p.length - 1; i++) best = Math.min(best, seg(x, y, p[i], p[i + 1]) - lw / 2);
    }
    return best;
  };
}

// 4-point sparkle, value < 1 inside
const sparkle = (x, y, cx, cy, s) =>
  Math.pow(Math.abs(x - cx) / s, 2 / 3) + Math.pow(Math.abs(y - cy) / s, 2 / 3);

// =========================================================================
// STYLE 1: aurora - vivid green-to-blue gradient, bold white $, glass ring
// =========================================================================
const aurora = (() => {
  const top = hex('#14E8A5');
  const bottom = hex('#1B5BFF');
  const navy = hex('#052A5E');
  const glyph = makeGlyph({ R: 0.088, stroke: 0.074, bar: 0.034, barExtra: 0.045 });
  return {
    background(x, y) {
      const t = clamp01((x * 0.45 + y * 0.75) / 1.1);
      let px = [...mix(top, bottom, smooth(0.05, 0.95, t)), 1];
      px = over(px, WHITE, 0.3 * (1 - smooth(0, 0.6, Math.hypot(x - 0.2, y - 0.1))));
      px = over(px, navy, 0.35 * smooth(0.55, 1.1, Math.hypot(x - 0.5, y - 0.5) * 1.3 + (y - 0.5) * 0.4));
      return px;
    },
    foreground(x, y) {
      let px = [0, 0, 0, 0];
      const d = Math.hypot(x - 0.5, y - 0.5);
      // glass disc and ring
      px = over(px, WHITE, (0.1 + 0.1 * (1 - y)) * (1 - smooth(0.355, 0.365, d)));
      px = over(px, WHITE, 0.55 * (1 - smooth(0, 0.011, Math.abs(d - 0.385))));
      px = over(px, WHITE, 0.22 * (1 - smooth(0, 0.007, Math.abs(d - 0.425))));
      // soft shadow under the $
      px = over(px, navy, 0.4 * (1 - smooth(-0.012, 0.05, glyph(x - 0.004, y - 0.03))));
      // the $
      const sd = glyph(x, y);
      px = over(px, mix(WHITE, hex('#D6FFEE'), y), 1 - smooth(-0.003, 0.003, sd));
      // sparkles
      for (const [sx, sy, s] of [[0.77, 0.23, 0.055], [0.23, 0.76, 0.034], [0.8, 0.7, 0.022]]) {
        px = over(px, WHITE, 0.95 * (1 - smooth(0.85, 1.0, sparkle(x, y, sx, sy, s))));
      }
      return px;
    },
  };
})();

// =========================================================================
// STYLE 2: neon - near-black, glowing mint $ and a rising trend line
// =========================================================================
const neon = (() => {
  const navyTop = hex('#101A3F');
  const navyBottom = hex('#04070F');
  const mintLight = hex('#B8FFE0');
  const mint = hex('#22E39E');
  const mintDeep = hex('#0BA574');
  const glyph = makeGlyph({ R: 0.084, stroke: 0.066, bar: 0.03, barExtra: 0.05, cy: 0.47 });
  const trend = [[0.2, 0.84], [0.34, 0.78], [0.45, 0.8], [0.58, 0.7], [0.7, 0.72], [0.82, 0.6]];
  const seg = (px, py, a, b) => {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const t = clamp01(((px - a[0]) * dx + (py - a[1]) * dy) / (dx * dx + dy * dy || 1));
    return Math.hypot(px - (a[0] + t * dx), py - (a[1] + t * dy));
  };
  const trendDist = (x, y) => {
    let b = Infinity;
    for (let i = 0; i < trend.length - 1; i++) b = Math.min(b, seg(x, y, trend[i], trend[i + 1]));
    return b - 0.011;
  };
  return {
    background(x, y) {
      let px = [...mix(navyTop, navyBottom, y), 1];
      px = over(px, mint, 0.3 * (1 - smooth(0, 0.62, Math.hypot(x - 0.5, y - 0.45))));
      px = over(px, hex('#4F8CFF'), 0.14 * (1 - smooth(0, 0.5, Math.hypot(x - 0.1, y - 0.95))));
      return px;
    },
    foreground(x, y) {
      let px = [0, 0, 0, 0];
      const sd = glyph(x, y);
      // glow
      px = over(px, mint, 0.55 * (1 - smooth(0, 0.11, sd)));
      px = over(px, mint, 0.35 * (1 - smooth(0, 0.04, sd)));
      // outline ring
      const d = Math.hypot(x - 0.5, y - 0.47);
      px = over(px, mint, 0.4 * (1 - smooth(0, 0.01, Math.abs(d - 0.37))));
      // glyph, bright on top and deeper at the bottom
      px = over(px, mix(mintLight, mintDeep, smooth(0.25, 0.75, y)), 1 - smooth(-0.003, 0.003, sd));
      // trend line with end dot
      const td = trendDist(x, y);
      px = over(px, mint, 0.4 * (1 - smooth(0, 0.035, td)));
      px = over(px, mintLight, 1 - smooth(-0.002, 0.003, td));
      px = over(px, WHITE, 1 - smooth(0.014, 0.02, Math.hypot(x - 0.82, y - 0.6)));
      return px;
    },
  };
})();

// =========================================================================
// STYLE 3: royal - indigo gradient, big beveled gold coin
// =========================================================================
const royal = (() => {
  const top = hex('#8B5CFF');
  const bottom = hex('#251A82');
  const goldLight = hex('#FFF4B8');
  const gold = hex('#FFC531');
  const goldDeep = hex('#B97A06');
  const rim = hex('#FFE77F');
  const ink = hex('#5A3700');
  const glyph = makeGlyph({ R: 0.07, stroke: 0.054, bar: 0.026, barExtra: 0.045 });
  return {
    background(x, y) {
      let px = [...mix(top, bottom, smooth(0, 1, y * 0.8 + x * 0.2)), 1];
      px = over(px, WHITE, 0.22 * (1 - smooth(0, 0.55, Math.hypot(x - 0.25, y - 0.15))));
      px = over(px, hex('#00D1FF'), 0.14 * (1 - smooth(0, 0.5, Math.hypot(x - 0.9, y - 0.95))));
      return px;
    },
    foreground(x, y) {
      let px = [0, 0, 0, 0];
      const d = Math.hypot(x - 0.5, y - 0.48);
      const coinR = 0.37;
      // drop shadow
      px = over(px, hex('#10064A'), 0.45 * (1 - smooth(coinR - 0.02, coinR + 0.07, Math.hypot(x - 0.5, (y - 0.56) * 1.1))));
      const edge = 1 - smooth(coinR - 0.004, coinR + 0.004, d);
      if (edge > 0) {
        px = over(px, mix(goldDeep, rim, smooth(0.15, 0.75, 1 - y)), edge);
        const faceR = 0.318;
        const face = 1 - smooth(faceR - 0.004, faceR + 0.004, d);
        const fd = Math.hypot(x - 0.4, y - 0.36) / 0.55;
        let c = mix(goldLight, gold, fd * 1.1);
        c = mix(c, goldDeep, (fd - 0.8) * 1.5);
        px = over(px, c, face * edge);
        px = over(px, goldDeep, 0.55 * (1 - smooth(0, 0.006, Math.abs(d - 0.285))) * face);
        // embossed $: light edge below, dark ink on top
        px = over(px, WHITE, 0.55 * (1 - smooth(-0.002, 0.008, glyph(x, y - 0.007) - 0.002)) * face);
        px = over(px, ink, 1 - smooth(-0.003, 0.003, glyph(x, y)));
        px = over(px, WHITE, 0.3 * (1 - smooth(0, 0.1, Math.hypot(x - 0.36, y - 0.3))) * edge);
      }
      for (const [sx, sy, s] of [[0.8, 0.2, 0.05], [0.18, 0.78, 0.03]]) {
        px = over(px, WHITE, 0.95 * (1 - smooth(0.85, 1.0, sparkle(x, y, sx, sy, s))));
      }
      return px;
    },
  };
})();

const STYLES = { aurora, neon, royal };

// ---- rasteriser with 3x3 supersampling ----
function render(size, pixelFn) {
  const out = Buffer.alloc(size * size * 4);
  const SS = 3;
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sj = 0; sj < SS; sj++) {
        for (let si = 0; si < SS; si++) {
          const px = pixelFn((i + (si + 0.5) / SS) / size, (j + (sj + 0.5) / SS) / size);
          r += px[0] * px[3];
          g += px[1] * px[3];
          b += px[2] * px[3];
          a += px[3];
        }
      }
      const n = SS * SS;
      const o = (j * size + i) * 4;
      if (a > 0) {
        out[o] = Math.round((r / a) * 255);
        out[o + 1] = Math.round((g / a) * 255);
        out[o + 2] = Math.round((b / a) * 255);
      }
      out[o + 3] = Math.round((a / n) * 255);
    }
  }
  return out;
}

const maskRound = fn => (x, y) => {
  const a = 1 - smooth(0.495, 0.5, Math.hypot(x - 0.5, y - 0.5));
  const p = fn(x, y);
  return [p[0], p[1], p[2], p[3] * a];
};
const maskSquircle = fn => (x, y) => {
  const r = 0.22;
  const qx = Math.abs(x - 0.5) - (0.5 - r);
  const qy = Math.abs(y - 0.5) - (0.5 - r);
  const sd = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) - r;
  const a = 1 - smooth(-0.004, 0.001, sd);
  const p = fn(x, y);
  return [p[0], p[1], p[2], p[3] * a];
};
const fullOf = st => (x, y) => {
  const bg = st.background(x, y);
  const fg = st.foreground(x, y);
  return over(bg, [fg[0], fg[1], fg[2]], fg[3]);
};

function write(file, buf) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, buf);
}

const args = process.argv.slice(2);
const sheetOnly = args.includes('--sheet');
const styleName = args.find(a => STYLES[a]) || DEFAULT_STYLE;

// Comparison sheet: all styles side by side on the dark app background.
{
  const tile = 300;
  const pad = 24;
  const names = Object.keys(STYLES);
  const W = names.length * tile + (names.length + 1) * pad;
  const H = tile + 2 * pad;
  const sheet = Buffer.alloc(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    sheet.set([11, 16, 32, 255], i * 4);
  }
  names.forEach((n, k) => {
    const px = render(tile, maskSquircle(fullOf(STYLES[n])));
    const ox = pad + k * (tile + pad);
    for (let y = 0; y < tile; y++) {
      for (let x = 0; x < tile; x++) {
        const s = (y * tile + x) * 4;
        const a = px[s + 3] / 255;
        const d = ((pad + y) * W + ox + x) * 4;
        for (let c = 0; c < 3; c++) sheet[d + c] = Math.round(px[s + c] * a + sheet[d + c] * (1 - a));
      }
    }
  });
  const out = path.join(__dirname, 'icon-styles.png');
  write(out, encodePng(W, H, sheet));
  console.log('Comparison sheet:', out, '(left to right:', names.join(', ') + ')');
}
if (sheetOnly) process.exit(0);

const st = STYLES[styleName];
const LEGACY = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
const ADAPTIVE = { mdpi: 108, hdpi: 162, xhdpi: 216, xxhdpi: 324, xxxhdpi: 432 };
const K = 0.8; // adaptive foreground shrunk into the safe zone
const adaptiveFg = (x, y) => st.foreground((x - 0.5) / K + 0.5, (y - 0.5) / K + 0.5);

for (const [d, size] of Object.entries(LEGACY)) {
  const dir = path.join(RES, `mipmap-${d}`);
  write(path.join(dir, 'ic_launcher.png'), encodePng(size, size, render(size, maskSquircle(fullOf(st)))));
  write(path.join(dir, 'ic_launcher_round.png'), encodePng(size, size, render(size, maskRound(fullOf(st)))));
}
for (const [d, size] of Object.entries(ADAPTIVE)) {
  const dir = path.join(RES, `mipmap-${d}`);
  write(path.join(dir, 'ic_launcher_foreground.png'), encodePng(size, size, render(size, adaptiveFg)));
  write(path.join(dir, 'ic_launcher_background.png'), encodePng(size, size, render(size, st.background)));
}
const adaptiveXml = `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@mipmap/ic_launcher_background"/>
    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>
</adaptive-icon>
`;
write(path.join(RES, 'mipmap-anydpi-v26', 'ic_launcher.xml'), Buffer.from(adaptiveXml));
write(path.join(RES, 'mipmap-anydpi-v26', 'ic_launcher_round.xml'), Buffer.from(adaptiveXml));
write(path.join(WEB, 'icon-512.png'), encodePng(512, 512, render(512, maskSquircle(fullOf(st)))));
// The same artwork, used inside the app (splash, login, header).
write(path.join(ASSETS, 'logo.png'), encodePng(512, 512, render(512, maskSquircle(fullOf(st)))));
write(path.join(WEB, 'favicon.png'), encodePng(64, 64, render(64, maskSquircle(fullOf(st)))));
console.log(`Icons written (style: ${styleName}).`);
