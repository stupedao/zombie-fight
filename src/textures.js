/* ============================================================
   DEAD HOURS - procedural asset factory
   ZERO external files: every color/normal/roughness map, every
   sprite and the environment map are painted here on 2D canvases
   at load time. Sobel-derived normal maps give the PBR shading
   its depth, fBm value-noise drives all the grime.
   v1.1 adds: rusted car paint, chain-link fence, window glass,
   puddle masks, a drifting cloud layer and acid glow sprites.
   ============================================================ */

import * as THREE from 'three';

/* ---------- tiny deterministic PRNG + value noise ---------- */

function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeNoise(seed) {
  const rand = mulberry32(seed);
  const perm = new Uint8Array(512);
  const p = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) {
    const j = (rand() * (i + 1)) | 0;
    [p[i], p[j]] = [p[j], p[i]];
  }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const hash = (x, y) => perm[(perm[x & 255] + y) & 255] / 255;
  const lerp = (a, b, t) => a + (b - a) * t;
  const noise2 = (x, y) => {
    const ix = Math.floor(x), iy = Math.floor(y);
    const fx = x - ix, fy = y - iy;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    return lerp(
      lerp(hash(ix, iy), hash(ix + 1, iy), sx),
      lerp(hash(ix, iy + 1), hash(ix + 1, iy + 1), sx),
      sy
    );
  };
  const fbm = (x, y, oct = 4, lac = 2, gain = 0.5) => {
    let a = 0, amp = 1, f = 1, norm = 0;
    for (let i = 0; i < oct; i++) {
      a += amp * noise2(x * f, y * f);
      norm += amp; amp *= gain; f *= lac;
    }
    return a / norm;
  };
  return { rand, noise2, fbm };
}

/* ---------- canvas helpers ---------- */

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

function tex(canvas, { srgb = true, repeat = null } = {}) {
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  if (repeat) t.repeat.set(repeat[0], repeat[1]);
  t.anisotropy = 4;
  return t;
}

/** Sobel the luminance of a canvas into a tangent-space normal map canvas. */
export function normalFromCanvas(srcCanvas, strength = 2.2) {
  const w = srcCanvas.width, h = srcCanvas.height;
  const sctx = srcCanvas.getContext('2d');
  const src = sctx.getImageData(0, 0, w, h).data;
  const out = makeCanvas(w, h);
  const octx = out.getContext('2d');
  const img = octx.createImageData(w, h);
  const d = img.data;
  const lum = (x, y) => {
    x = Math.max(0, Math.min(w - 1, x)); y = Math.max(0, Math.min(h - 1, y));
    const i = (y * w + x) * 4;
    return (src[i] * 0.299 + src[i + 1] * 0.587 + src[i + 2] * 0.114) / 255;
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const gx = (lum(x + 1, y - 1) + 2 * lum(x + 1, y) + lum(x + 1, y + 1))
               - (lum(x - 1, y - 1) + 2 * lum(x - 1, y) + lum(x - 1, y + 1));
      const gy = (lum(x - 1, y + 1) + 2 * lum(x, y + 1) + lum(x + 1, y + 1))
               - (lum(x - 1, y - 1) + 2 * lum(x, y - 1) + lum(x + 1, y - 1));
      let nx = -gx * strength, ny = -gy * strength, nz = 1;
      const len = Math.hypot(nx, ny, nz);
      nx /= len; ny /= len; nz /= len;
      const i = (y * w + x) * 4;
      d[i] = (nx * 0.5 + 0.5) * 255;
      d[i + 1] = (ny * 0.5 + 0.5) * 255;
      d[i + 2] = (nz * 0.5 + 0.5) * 255;
      d[i + 3] = 255;
    }
  }
  octx.putImageData(img, 0, 0);
  return out;
}

/** Map a source canvas' luminance into a roughness canvas. */
function roughnessFromCanvas(srcCanvas, base = 0.75, range = 0.2) {
  const w = srcCanvas.width, h = srcCanvas.height;
  const src = srcCanvas.getContext('2d').getImageData(0, 0, w, h).data;
  const out = makeCanvas(w, h);
  const octx = out.getContext('2d');
  const img = octx.createImageData(w, h);
  const d = img.data;
  for (let i = 0; i < w * h; i++) {
    const l = (src[i * 4] * 0.299 + src[i * 4 + 1] * 0.587 + src[i * 4 + 2] * 0.114) / 255;
    const r = Math.max(0.05, Math.min(1, base + (l - 0.5) * 2 * range)) * 255;
    d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = r;
    d[i * 4 + 3] = 255;
  }
  octx.putImageData(img, 0, 0);
  return out;
}

/** Fill a canvas pixel-by-pixel with a color function. */
function paintPixels(canvas, fn) {
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(canvas.width, canvas.height);
  const d = img.data;
  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      const i = (y * canvas.width + x) * 4;
      const [r, g, b, a] = fn(x, y);
      d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = a === undefined ? 255 : a;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

function mix(c1, c2, t) {
  return [
    c1[0] + (c2[0] - c1[0]) * t,
    c1[1] + (c2[1] - c1[1]) * t,
    c1[2] + (c2[2] - c1[2]) * t,
  ];
}

/* ============================================================
   texture painters
   ============================================================ */

function paintDirt(seed = 7) {
  const S = 512;
  const c = makeCanvas(S, S);
  const n = makeNoise(seed);
  const base = [56, 48, 38], dark = [34, 29, 22], light = [82, 72, 55];
  paintPixels(c, (x, y) => {
    const f = n.fbm(x / 90, y / 90, 5);
    const g = n.fbm(x / 14 + 40, y / 14 + 40, 3);
    let col = mix(mix(dark, base, f), light, g * 0.35);
    // pebble speckle
    const peb = n.noise2(x / 2.1, y / 2.1);
    if (peb > 0.93) col = mix(col, [110, 102, 88], 0.8);
    else if (peb < 0.05) col = mix(col, [22, 18, 14], 0.7);
    return [col[0], col[1], col[2], 255];
  });
  const ctx = c.getContext('2d');
  // cracks - random walks
  ctx.lineCap = 'round';
  for (let k = 0; k < 14; k++) {
    let x = n.rand() * S, y = n.rand() * S;
    let a = n.rand() * Math.PI * 2;
    ctx.strokeStyle = `rgba(18,14,10,${0.55 + n.rand() * 0.3})`;
    ctx.lineWidth = 1 + n.rand() * 1.6;
    ctx.beginPath(); ctx.moveTo(x, y);
    const steps = 20 + (n.rand() * 40) | 0;
    for (let s = 0; s < steps; s++) {
      a += (n.rand() - 0.5) * 0.9;
      x += Math.cos(a) * 6; y += Math.sin(a) * 6;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  // dry grass tufts (tiny strokes)
  for (let k = 0; k < 120; k++) {
    const x = n.rand() * S, y = n.rand() * S;
    ctx.strokeStyle = `rgba(${70 + n.rand() * 30 | 0},${62 + n.rand() * 25 | 0},${34 + n.rand() * 18 | 0},0.5)`;
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x, y);
    ctx.lineTo(x + (n.rand() - 0.5) * 6, y - 4 - n.rand() * 5);
    ctx.stroke();
  }
  return c;
}

function paintConcrete(seed = 11) {
  const S = 512;
  const c = makeCanvas(S, S);
  const n = makeNoise(seed);
  paintPixels(c, (x, y) => {
    const f = n.fbm(x / 70, y / 70, 5);
    const g = n.fbm(x / 8 + 90, y / 8 + 90, 2);
    let v = 0.5 + (f - 0.5) * 0.55 + (g - 0.5) * 0.08;
    let col = [104 * v + 20, 103 * v + 20, 98 * v + 20];
    return [col[0], col[1], col[2], 255];
  });
  const ctx = c.getContext('2d');
  // water stains bleeding down
  for (let k = 0; k < 9; k++) {
    const x = n.rand() * S, w = 8 + n.rand() * 26;
    const grad = ctx.createLinearGradient(0, 0, 0, S);
    grad.addColorStop(0, 'rgba(30,32,30,0.34)');
    grad.addColorStop(1, 'rgba(30,32,30,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(x, 0, w, 120 + n.rand() * 260);
  }
  // cracks
  ctx.strokeStyle = 'rgba(22,22,20,0.6)';
  for (let k = 0; k < 7; k++) {
    let x = n.rand() * S, y = n.rand() * S, a = Math.PI / 2 + (n.rand() - 0.5);
    ctx.lineWidth = 1 + n.rand();
    ctx.beginPath(); ctx.moveTo(x, y);
    for (let s = 0; s < 24; s++) {
      a += (n.rand() - 0.5) * 0.5;
      x += Math.cos(a) * 8; y += Math.sin(a) * 8;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  return c;
}

function paintBrick(seed = 23) {
  const S = 512;
  const c = makeCanvas(S, S);
  const n = makeNoise(seed);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#4c463c';
  ctx.fillRect(0, 0, S, S);
  const rows = 8, bw = 64, bh = S / rows;
  for (let r = 0; r < rows; r++) {
    const off = (r % 2) * (bw / 2);
    for (let bX = -1; bX < S / bw + 1; bX++) {
      const x = bX * bw + off + 2, y = r * bh + 2;
      const w = bw - 4, h = bh - 4;
      const t = n.rand();
      const base = mix([122, 74, 58], [88, 52, 42], t);
      ctx.fillStyle = `rgb(${base[0] | 0},${base[1] | 0},${base[2] | 0})`;
      ctx.fillRect(x, y, w, h);
      // brick shading
      ctx.fillStyle = 'rgba(0,0,0,0.22)';
      ctx.fillRect(x, y + h - 3, w, 3);
      ctx.fillStyle = 'rgba(255,255,255,0.07)';
      ctx.fillRect(x, y, w, 3);
    }
  }
  // grime overlay (single bulk read - no per-pixel getImageData)
  const im = ctx.getImageData(0, 0, S, S);
  const dd = im.data;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const f = n.fbm(x / 60 + 30, y / 60 + 30, 4);
      const k = 1 - Math.max(0, f - 0.45) * 0.7;
      const i = (y * S + x) * 4;
      dd[i] *= k; dd[i + 1] *= k; dd[i + 2] *= k;
    }
  }
  ctx.putImageData(im, 0, 0);
  return c;
}

function paintMetal(seed = 31) {
  const S = 256;
  const c = makeCanvas(S, S);
  const n = makeNoise(seed);
  paintPixels(c, (x, y) => {
    const streak = n.fbm(x / 3, y / 60, 3);
    const rust = n.fbm(x / 40 + 80, y / 40 + 80, 4);
    let v = 0.5 + (streak - 0.5) * 0.4;
    let col = [52 * v + 14, 56 * v + 14, 62 * v + 14];
    if (rust > 0.62) {
      const t = Math.min(1, (rust - 0.62) * 5);
      col = mix(col, [128, 66, 34], t * 0.85);
    }
    return [col[0], col[1], col[2], 255];
  });
  const ctx = c.getContext('2d');
  // barrel ribs
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  ctx.fillRect(0, S * 0.28, S, 5);
  ctx.fillRect(0, S * 0.72, S, 5);
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.fillRect(0, S * 0.28 + 5, S, 4);
  ctx.fillRect(0, S * 0.72 + 5, S, 4);
  return c;
}

function paintWood(seed = 41) {
  const S = 256;
  const c = makeCanvas(S, S);
  const n = makeNoise(seed);
  paintPixels(c, (x, y) => {
    const grain = n.fbm(x / 2.5, y / 26, 3);
    const v = 0.5 + (grain - 0.5) * 0.5;
    let col = [128 * v + 52, 96 * v + 36, 62 * v + 22];
    return [col[0], col[1], col[2], 255];
  });
  const ctx = c.getContext('2d');
  // plank gaps
  ctx.fillStyle = 'rgba(20,12,6,0.85)';
  for (let p = 1; p < 4; p++) ctx.fillRect(0, p * (S / 4) - 2, S, 4);
  // knots
  for (let k = 0; k < 5; k++) {
    const x = n.rand() * S, y = n.rand() * S;
    const g = ctx.createRadialGradient(x, y, 1, x, y, 8 + n.rand() * 6);
    g.addColorStop(0, 'rgba(35,20,8,0.9)');
    g.addColorStop(1, 'rgba(35,20,8,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - 16, y - 16, 32, 32);
  }
  return c;
}

function paintBark(seed = 53) {
  const S = 256;
  const c = makeCanvas(S, S);
  const n = makeNoise(seed);
  paintPixels(c, (x, y) => {
    const ridge = n.fbm(x / 6, y / 40, 4);
    const v = 0.5 + (ridge - 0.5) * 0.9;
    let col = [66 * v + 12, 52 * v + 10, 40 * v + 8];
    return [col[0], col[1], col[2], 255];
  });
  return c;
}

/* ---------- NEW v1.1: rusted car paint ---------- */

function paintCarPaint(seed = 131, tint = [96, 104, 116]) {
  const S = 256;
  const c = makeCanvas(S, S);
  const n = makeNoise(seed);
  paintPixels(c, (x, y) => {
    // clearcoat gloss variation + fine scratches
    const gloss = n.fbm(x / 60 + 20, y / 60 + 20, 3);
    const dirt = n.fbm(x / 22 + 70, y / 22 + 70, 3);
    let v = 0.82 + (gloss - 0.5) * 0.25;
    let col = [tint[0] * v, tint[1] * v, tint[2] * v];
    // dirt film
    if (dirt > 0.6) col = mix(col, [44, 42, 38], (dirt - 0.6) * 1.6);
    return [col[0], col[1], col[2], 255];
  });
  const ctx = c.getContext('2d');
  // rust blooms eating through the paint
  for (let k = 0; k < 12; k++) {
    const x = n.rand() * S, y = n.rand() * S;
    const r = 8 + n.rand() * 30;
    const g = ctx.createRadialGradient(x, y, 1, x, y, r);
    const deep = n.rand() > 0.5;
    g.addColorStop(0, deep ? 'rgba(70,32,14,0.95)' : 'rgba(120,62,30,0.8)');
    g.addColorStop(0.55, 'rgba(110,58,28,0.6)');
    g.addColorStop(1, 'rgba(90,48,24,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  // scratches
  ctx.lineCap = 'round';
  for (let k = 0; k < 22; k++) {
    const x = n.rand() * S, y = n.rand() * S;
    const a = n.rand() * Math.PI * 2, len = 6 + n.rand() * 24;
    ctx.strokeStyle = `rgba(${150 + n.rand() * 60 | 0},${140 + n.rand() * 50 | 0},${130 + n.rand() * 40 | 0},${0.12 + n.rand() * 0.25})`;
    ctx.lineWidth = 0.7 + n.rand();
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
    ctx.stroke();
  }
  return c;
}

/* ---------- NEW v1.1: chain-link fence ---------- */

function paintFence(seed = 137) {
  const S = 128;
  const c = makeCanvas(S, S);
  const ctx = c.getContext('2d');
  const n = makeNoise(seed);
  ctx.clearRect(0, 0, S, S);
  const spacing = 16;
  ctx.lineCap = 'round';
  // two diagonal directions => diamond lattice
  for (const dir of [1, -1]) {
    for (let off = -S; off < S * 2; off += spacing) {
      const rust = n.rand();
      ctx.strokeStyle = rust > 0.7
        ? `rgba(${118 + rust * 40 | 0},${68 + rust * 20 | 0},40,0.9)`
        : `rgba(${158 + rust * 30 | 0},${164 + rust * 20 | 0},${170 + rust * 10 | 0},0.9)`;
      ctx.lineWidth = 2.1 + n.rand() * 0.5;
      ctx.beginPath();
      if (dir === 1) { ctx.moveTo(off, 0); ctx.lineTo(off + S, S); }
      else { ctx.moveTo(off, S); ctx.lineTo(off + S, 0); }
      ctx.stroke();
    }
  }
  return c;
}

/* ---------- NEW v1.1: window glass ---------- */

function paintWindow(seed = 149) {
  const S = 128;
  const c = makeCanvas(S, S);
  const ctx = c.getContext('2d');
  const n = makeNoise(seed);
  // pane layout 2x2 with frame cross
  ctx.fillStyle = '#181d26';
  ctx.fillRect(0, 0, S, S);
  // inner panes - very dark glass with grime
  const pad = 9, pane = (S - pad * 2) / 2;
  for (const [px, py] of [[pad, pad], [pad + pane + 2, pad], [pad, pad + pane + 2], [pad + pane + 2, pad + pane + 2]]) {
    const g = ctx.createLinearGradient(px, py, px + pane, py + pane);
    g.addColorStop(0, '#242e3c');
    g.addColorStop(0.5, '#151b26');
    g.addColorStop(1, '#1d2733');
    ctx.fillStyle = g;
    ctx.fillRect(px, py, pane, pane);
    // faint reflection streak
    ctx.fillStyle = 'rgba(120,150,190,0.05)';
    ctx.beginPath();
    ctx.moveTo(px + pane * 0.15, py);
    ctx.lineTo(px + pane * 0.45, py);
    ctx.lineTo(px + pane * 0.75, py + pane);
    ctx.lineTo(px + pane * 0.45, py + pane);
    ctx.closePath();
    ctx.fill();
    // grime speckle
    for (let k = 0; k < 26; k++) {
      const rx = px + n.rand() * pane, ry = py + n.rand() * pane;
      ctx.fillStyle = `rgba(60,58,52,${0.04 + n.rand() * 0.1})`;
      ctx.fillRect(rx, ry, 1 + n.rand() * 3, 1 + n.rand() * 3);
    }
    // occasional crack
    if (n.rand() > 0.72) {
      ctx.strokeStyle = 'rgba(200,215,235,0.22)';
      ctx.lineWidth = 0.8;
      const cx = px + pane * 0.3 + n.rand() * pane * 0.4;
      const cy = py + pane * 0.3 + n.rand() * pane * 0.4;
      ctx.beginPath(); ctx.moveTo(cx, cy);
      let a = n.rand() * Math.PI * 2, x = cx, y = cy;
      for (let s = 0; s < 4; s++) {
        a += (n.rand() - 0.5) * 1.4;
        x += Math.cos(a) * 9; y += Math.sin(a) * 9;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }
  return c;
}

/* ---------- NEW v1.1: puddle alpha mask ---------- */

function paintPuddleMask(seed = 157) {
  const S = 128;
  const c = makeCanvas(S, S);
  const ctx = c.getContext('2d');
  const n = makeNoise(seed);
  // opaque black background - the WHITE blob is what shows (alphaMap reads .g)
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, S, S);
  // irregular blob: radial with noise-modulated edge
  const cx = S / 2, cy = S / 2;
  const pts = 26;
  ctx.beginPath();
  for (let k = 0; k <= pts; k++) {
    const a = (k / pts) * Math.PI * 2;
    const rMod = 0.62 + n.fbm(Math.cos(a) * 2 + 5, Math.sin(a) * 2 + 5, 3) * 0.55;
    const r = (S / 2 - 6) * rMod;
    const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r * 0.82;
    if (k === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  const g = ctx.createRadialGradient(cx, cy, S * 0.16, cx, cy, S * 0.5);
  g.addColorStop(0, 'rgba(255,255,255,0.95)');
  g.addColorStop(0.8, 'rgba(255,255,255,0.75)');
  g.addColorStop(1, 'rgba(255,255,255,0.25)');
  ctx.fillStyle = g;
  ctx.fill();
  return c;
}

/* ---------- NEW v1.1: drifting cloud layer ---------- */

function paintClouds(seed = 163) {
  const W = 1024, H = 512;
  const c = makeCanvas(W, H);
  const ctx = c.getContext('2d');
  const n = makeNoise(seed);
  ctx.clearRect(0, 0, W, H);
  // soft elongated dark clouds with moon-lit tops
  for (let k = 0; k < 26; k++) {
    const x = n.rand() * W, y = H * (0.34 + n.rand() * 0.5);
    const rw = 110 + n.rand() * 220, rh = 20 + n.rand() * 40;
    const lit = n.rand();
    const g = ctx.createRadialGradient(x, y, 1, x, y, rw);
    if (lit > 0.62) {
      // moonlit edge - silver top, dark body
      g.addColorStop(0, 'rgba(52,68,94,0.5)');
      g.addColorStop(0.7, 'rgba(30,40,58,0.34)');
      g.addColorStop(1, 'rgba(24,32,48,0)');
    } else {
      g.addColorStop(0, 'rgba(14,20,32,0.52)');
      g.addColorStop(1, 'rgba(14,20,32,0)');
    }
    ctx.fillStyle = g;
    ctx.save();
    ctx.translate(x, y); ctx.scale(1, rh / rw); ctx.translate(-x, -y);
    ctx.beginPath(); ctx.arc(x, y, rw, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
  return c;
}

function paintZombieSkin(seed = 61, hue = 96) {
  const S = 256;
  const c = makeCanvas(S, S);
  const n = makeNoise(seed);
  paintPixels(c, (x, y) => {
    const mottle = n.fbm(x / 34, y / 34, 5);
    const pore = n.fbm(x / 5 + 60, y / 5 + 60, 2);
    const v = 0.5 + (mottle - 0.5) * 0.7 + (pore - 0.5) * 0.12;
    // sickly desaturated green-grey
    const r = 96 * v + 28, g = 104 * v + 34, b = 86 * v + 26;
    return [r + hue * 0.1, g, b - hue * 0.05, 255];
  });
  const ctx = c.getContext('2d');
  // veins - branching dark walks
  ctx.lineCap = 'round';
  for (let k = 0; k < 10; k++) {
    let x = n.rand() * S, y = n.rand() * S, a = n.rand() * Math.PI * 2;
    ctx.strokeStyle = 'rgba(46,64,52,0.5)';
    ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(x, y);
    for (let s = 0; s < 14; s++) {
      a += (n.rand() - 0.5) * 0.8;
      x += Math.cos(a) * 9; y += Math.sin(a) * 9;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  // open wounds
  for (let k = 0; k < 5; k++) {
    const x = n.rand() * S, y = n.rand() * S, r = 9 + n.rand() * 16;
    const g = ctx.createRadialGradient(x, y, 1, x, y, r);
    g.addColorStop(0, 'rgba(88,10,8,0.95)');
    g.addColorStop(0.6, 'rgba(70,16,10,0.8)');
    g.addColorStop(1, 'rgba(60,30,20,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  return c;
}

function paintCloth(seed = 71, tint = [40, 46, 60]) {
  const S = 128;
  const c = makeCanvas(S, S);
  const n = makeNoise(seed);
  paintPixels(c, (x, y) => {
    const weave = n.noise2(x / 1.4, y / 1.4) * 0.5 + n.fbm(x / 24, y / 24, 3) * 0.5;
    const v = 0.72 + (weave - 0.5) * 0.5;
    // dirt stains
    const stain = n.fbm(x / 40 + 50, y / 40 + 50, 3);
    const sv = stain > 0.6 ? 0.6 : 1;
    return [tint[0] * v * sv, tint[1] * v * sv, tint[2] * v * sv, 255];
  });
  return c;
}

function paintMoon(seed = 83) {
  const S = 256;
  const c = makeCanvas(S, S);
  const n = makeNoise(seed);
  paintPixels(c, (x, y) => {
    const f = n.fbm(x / 30, y / 30, 4);
    const v = 0.86 + (f - 0.5) * 0.2;
    return [225 * v, 224 * v, 218 * v, 255];
  });
  const ctx = c.getContext('2d');
  for (let k = 0; k < 16; k++) {
    const x = n.rand() * S, y = n.rand() * S, r = 4 + n.rand() * 18;
    const g = ctx.createRadialGradient(x - r * 0.2, y - r * 0.2, r * 0.1, x, y, r);
    g.addColorStop(0, 'rgba(150,150,148,0.55)');
    g.addColorStop(0.75, 'rgba(190,190,188,0.3)');
    g.addColorStop(0.95, 'rgba(235,235,232,0.5)'); // bright rim
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  return c;
}

function paintSky(seed = 97) {
  const W = 1024, H = 512;
  const c = makeCanvas(W, H);
  const ctx = c.getContext('2d');
  const n = makeNoise(seed);
  // vertical gradient
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, '#04060d');
  grad.addColorStop(0.45, '#070c17');
  grad.addColorStop(0.72, '#0c1524');
  grad.addColorStop(0.85, '#152338');
  grad.addColorStop(1, '#1b2a41');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);
  // faint milky band
  ctx.save();
  ctx.globalAlpha = 0.06;
  ctx.fillStyle = '#9fb4d8';
  for (let k = 0; k < 260; k++) {
    const x = n.rand() * W;
    const y = H * 0.28 + Math.sin((x / W) * Math.PI * 2) * 60 + (n.rand() - 0.5) * 80;
    ctx.fillRect(x, y, 1 + n.rand() * 2, 1 + n.rand());
  }
  ctx.restore();
  // stars
  for (let k = 0; k < 620; k++) {
    const x = n.rand() * W, y = n.rand() * H * 0.78;
    const b = 0.25 + n.rand() * 0.75;
    const size = n.rand() > 0.94 ? 2 : 1;
    ctx.fillStyle = `rgba(${215 + n.rand() * 40 | 0},${220 + n.rand() * 35 | 0},${235 + n.rand() * 20 | 0},${b * (1 - y / (H * 0.9))})`;
    ctx.fillRect(x, y, size, size);
  }
  // few glowing stars
  for (let k = 0; k < 24; k++) {
    const x = n.rand() * W, y = n.rand() * H * 0.6;
    const g = ctx.createRadialGradient(x, y, 0, x, y, 3.5);
    g.addColorStop(0, 'rgba(255,255,255,0.95)');
    g.addColorStop(1, 'rgba(200,220,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - 4, y - 4, 8, 8);
  }
  // clouds - soft dark blobs
  for (let k = 0; k < 14; k++) {
    const x = n.rand() * W, y = H * (0.5 + n.rand() * 0.4);
    const rw = 90 + n.rand() * 190, rh = 18 + n.rand() * 34;
    const g = ctx.createRadialGradient(x, y, 1, x, y, rw);
    g.addColorStop(0, 'rgba(16,26,40,0.55)');
    g.addColorStop(1, 'rgba(16,26,40,0)');
    ctx.fillStyle = g;
    ctx.save();
    ctx.translate(x, y); ctx.scale(1, rh / rw); ctx.translate(-x, -y);
    ctx.beginPath(); ctx.arc(x, y, rw, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
  // moonlit haze near horizon
  const hz = ctx.createLinearGradient(0, H * 0.8, 0, H);
  hz.addColorStop(0, 'rgba(70,100,150,0)');
  hz.addColorStop(1, 'rgba(70,100,150,0.14)');
  ctx.fillStyle = hz;
  ctx.fillRect(0, H * 0.8, W, H * 0.2);
  return c;
}

function radialSprite(size, stops, oval = 1) {
  const c = makeCanvas(size, size);
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [p, col] of stops) g.addColorStop(p, col);
  ctx.fillStyle = g;
  if (oval !== 1) {
    ctx.save();
    ctx.translate(size / 2, size / 2); ctx.scale(1, oval); ctx.translate(-size / 2, -size / 2);
  }
  ctx.fillRect(0, 0, size, size);
  if (oval !== 1) ctx.restore();
  return c;
}

function paintFlash() {
  const S = 64;
  const c = radialSprite(S, [
    [0, 'rgba(255,255,240,1)'],
    [0.25, 'rgba(255,220,140,0.9)'],
    [0.55, 'rgba(255,150,50,0.35)'],
    [1, 'rgba(255,120,30,0)'],
  ]);
  const ctx = c.getContext('2d');
  // star spikes
  ctx.strokeStyle = 'rgba(255,245,220,0.85)';
  ctx.lineWidth = 2;
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2 + 0.4;
    ctx.beginPath();
    ctx.moveTo(32 + Math.cos(a) * 4, 32 + Math.sin(a) * 4);
    ctx.lineTo(32 + Math.cos(a) * 30, 32 + Math.sin(a) * 30);
    ctx.stroke();
  }
  return c;
}

function paintBlood(seed = 101) {
  const S = 128;
  const c = makeCanvas(S, S);
  const ctx = c.getContext('2d');
  const n = makeNoise(seed);
  ctx.clearRect(0, 0, S, S);
  const cx = S / 2, cy = S / 2;
  const g = ctx.createRadialGradient(cx, cy, 2, cx, cy, 30);
  g.addColorStop(0, 'rgba(74,8,5,0.95)');
  g.addColorStop(0.7, 'rgba(60,7,4,0.85)');
  g.addColorStop(1, 'rgba(50,6,3,0)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(cx, cy, 30, 0, Math.PI * 2); ctx.fill();
  // splatter droplets
  for (let k = 0; k < 26; k++) {
    const a = n.rand() * Math.PI * 2;
    const d = 22 + n.rand() * 36;
    const x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d;
    const r = 1.5 + n.rand() * 5;
    ctx.fillStyle = `rgba(${60 + n.rand() * 25 | 0},${7 + n.rand() * 5 | 0},${4 + n.rand() * 4 | 0},${0.5 + n.rand() * 0.45})`;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  // streak tails
  for (let k = 0; k < 8; k++) {
    const a = n.rand() * Math.PI * 2;
    ctx.strokeStyle = 'rgba(58,7,4,0.6)';
    ctx.lineWidth = 2 + n.rand() * 2;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * 18, cy + Math.sin(a) * 18);
    ctx.lineTo(cx + Math.cos(a) * 44, cy + Math.sin(a) * 44);
    ctx.stroke();
  }
  return c;
}

function paintHole() {
  const S = 64;
  const c = makeCanvas(S, S);
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, S, S);
  const g = ctx.createRadialGradient(32, 32, 1, 32, 32, 26);
  g.addColorStop(0, 'rgba(8,6,5,0.95)');
  g.addColorStop(0.35, 'rgba(20,16,12,0.8)');
  g.addColorStop(0.7, 'rgba(40,34,28,0.35)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  // radial cracks
  const n = makeNoise(7);
  ctx.strokeStyle = 'rgba(15,12,10,0.7)';
  for (let k = 0; k < 7; k++) {
    const a = n.rand() * Math.PI * 2;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(32 + Math.cos(a) * 6, 32 + Math.sin(a) * 6);
    ctx.lineTo(32 + Math.cos(a) * (14 + n.rand() * 12), 32 + Math.sin(a) * (14 + n.rand() * 12));
    ctx.stroke();
  }
  return c;
}

function paintGrassBlade(seed = 113) {
  const S = 64;
  const c = makeCanvas(S, S);
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, S, S);
  const n = makeNoise(seed);
  for (let k = 0; k < 9; k++) {
    const x0 = 8 + n.rand() * 48;
    const lean = (n.rand() - 0.5) * 22;
    const hgt = 26 + n.rand() * 30;
    const w = 1.6 + n.rand() * 1.8;
    const green = 60 + n.rand() * 40;
    ctx.strokeStyle = `rgb(${green * 0.82 | 0},${green | 0},${green * 0.45 | 0})`;
    ctx.lineWidth = w;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x0, S);
    ctx.quadraticCurveTo(x0 + lean * 0.3, S - hgt * 0.6, x0 + lean, S - hgt);
    ctx.stroke();
  }
  return c;
}

/* ============================================================
   public factory
   ============================================================ */

export function buildTextures() {
  const T = {};

  // ---- terrain ----
  const dirt = paintDirt();
  T.dirt = {
    map: tex(dirt, { repeat: [22, 22] }),
    normal: tex(normalFromCanvas(dirt, 1.6), { srgb: false, repeat: [22, 22] }),
    rough: tex(roughnessFromCanvas(dirt, 0.93, 0.1), { srgb: false, repeat: [22, 22] }),
  };

  // ---- structures ----
  const concrete = paintConcrete();
  T.concrete = {
    map: tex(concrete, { repeat: [3, 1.6] }),
    normal: tex(normalFromCanvas(concrete, 2.0), { srgb: false, repeat: [3, 1.6] }),
    rough: tex(roughnessFromCanvas(concrete, 0.9, 0.12), { srgb: false, repeat: [3, 1.6] }),
  };
  const brick = paintBrick();
  T.brick = {
    map: tex(brick, { repeat: [2.4, 1.4] }),
    normal: tex(normalFromCanvas(brick, 2.4), { srgb: false, repeat: [2.4, 1.4] }),
    rough: tex(roughnessFromCanvas(brick, 0.85, 0.15), { srgb: false, repeat: [2.4, 1.4] }),
  };
  const metal = paintMetal();
  T.metal = {
    map: tex(metal),
    normal: tex(normalFromCanvas(metal, 1.2), { srgb: false }),
    rough: tex(roughnessFromCanvas(metal, 0.55, 0.25), { srgb: false }),
  };
  const wood = paintWood();
  T.wood = {
    map: tex(wood),
    normal: tex(normalFromCanvas(wood, 1.5), { srgb: false }),
    rough: tex(roughnessFromCanvas(wood, 0.8, 0.15), { srgb: false }),
  };
  const bark = paintBark();
  T.bark = {
    map: tex(bark, { repeat: [1.5, 3] }),
    normal: tex(normalFromCanvas(bark, 2.6), { srgb: false, repeat: [1.5, 3] }),
  };

  // ---- NEW v1.1: wrecked cars / fence / windows / puddles / clouds ----
  const carA = paintCarPaint(131, [86, 94, 108]);   // gunmetal blue-grey
  const carB = paintCarPaint(139, [104, 78, 60]);   // baked brown
  T.car = [
    {
      map: tex(carA),
      normal: tex(normalFromCanvas(carA, 1.1), { srgb: false }),
      rough: tex(roughnessFromCanvas(carA, 0.42, 0.3), { srgb: false }),
    },
    {
      map: tex(carB),
      normal: tex(normalFromCanvas(carB, 1.1), { srgb: false }),
      rough: tex(roughnessFromCanvas(carB, 0.42, 0.3), { srgb: false }),
    },
  ];
  T.fence = tex(paintFence());
  T.window = tex(paintWindow());
  T.puddleMask = tex(paintPuddleMask(), { srgb: false });
  T.clouds = tex(paintClouds());

  // ---- zombies ----
  T.skin = [];
  for (let v = 0; v < 3; v++) {
    const skin = paintZombieSkin(61 + v * 13, v === 1 ? 110 : 82);
    T.skin.push({
      map: tex(skin, { repeat: [2, 2] }),
      normal: tex(normalFromCanvas(skin, 1.4), { srgb: false, repeat: [2, 2] }),
      rough: tex(roughnessFromCanvas(skin, 0.88, 0.12), { srgb: false, repeat: [2, 2] }),
    });
  }
  T.cloth = [];
  const clothTints = [[36, 42, 58], [52, 38, 30], [34, 46, 38], [46, 46, 48]];
  for (let v = 0; v < 4; v++) {
    const cloth = paintCloth(71 + v * 7, clothTints[v]);
    T.cloth.push({
      map: tex(cloth, { repeat: [2, 2] }),
      rough: tex(roughnessFromCanvas(cloth, 0.95, 0.08), { srgb: false, repeat: [2, 2] }),
    });
  }

  // ---- sky & moon ----
  T.moon = tex(paintMoon());
  T.sky = tex(paintSky());

  // ---- sprites ----
  T.flash = tex(paintFlash());
  T.glow = tex(radialSprite(64, [
    [0, 'rgba(255,255,255,1)'], [0.3, 'rgba(255,240,210,0.6)'], [1, 'rgba(255,240,210,0)'],
  ]));
  T.flame = tex(radialSprite(64, [
    [0, 'rgba(255,240,190,1)'], [0.3, 'rgba(255,170,60,0.85)'], [0.6, 'rgba(220,80,20,0.4)'], [1, 'rgba(120,30,10,0)'],
  ]));
  T.smoke = tex(radialSprite(64, [
    [0, 'rgba(120,120,125,0.55)'], [0.5, 'rgba(90,90,95,0.28)'], [1, 'rgba(70,70,75,0)'],
  ]));
  T.spark = tex(radialSprite(32, [
    [0, 'rgba(255,255,255,1)'], [0.3, 'rgba(255,220,140,0.9)'], [1, 'rgba(255,180,80,0)'],
  ]));
  T.blood = tex(paintBlood());
  T.hole = tex(paintHole());
  T.grassBlade = tex(paintGrassBlade());
  // NEW: toxic green glow for spitter acid
  T.acidGlow = tex(radialSprite(64, [
    [0, 'rgba(210,255,150,1)'], [0.3, 'rgba(140,240,60,0.75)'], [0.65, 'rgba(80,180,30,0.3)'], [1, 'rgba(40,120,20,0)'],
  ]));

  return T;
}

/** small procedural equirect for PMREM environment reflections */
export function buildEnvCanvas() {
  const W = 256, H = 128;
  const c = makeCanvas(W, H);
  const ctx = c.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, '#0c1626');
  grad.addColorStop(0.5, '#18293f');
  grad.addColorStop(0.55, '#20303f');
  grad.addColorStop(1, '#0a0806');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);
  // moon glow blob in the "sky" half
  const g = ctx.createRadialGradient(W * 0.72, H * 0.2, 2, W * 0.72, H * 0.2, 34);
  g.addColorStop(0, 'rgba(210,225,255,0.9)');
  g.addColorStop(1, 'rgba(210,225,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H * 0.5);
  return c;
}
