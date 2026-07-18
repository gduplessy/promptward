// Generate Chrome Web Store promo screenshots (1280x800 JPEG) from raw capture
// PNGs. The raw captures are widescreen browser windows (~1.94 AR); the Store
// wants 1.6 AR. Per the maintainer's choice, each capture is centered on a
// PromptWard-branded backdrop with a headline overlay, rather than cropped.
//
//   node scripts/make-promo-screenshots.mjs <input.png> <output.jpg> [headline]
//
// If no headline is given, a default is used. Brand colors come from
// src/sidepanel.css (dark slate #0f172a primary, #f8fafc/#e2e8f0 surfaces).
import { readFileSync } from "node:fs";
import sharp from "sharp";

const [, , inputArg, outputArg, headlineArg] = process.argv;
if (!inputArg || !outputArg) {
  console.error("Usage: node scripts/make-promo-screenshots.mjs <input.png> <output.jpg> [headline]");
  process.exit(1);
}

const OUT_W = 1280;
const OUT_H = 800;
const PADDING_X = 80; // left/right margin around the screenshot on the backdrop
const HEADLINE = headlineArg ?? "Your PII, redacted before it leaves your browser";
const SUBHEAD = "Local detection. No prompt text ever sent to a server.";

// Brand palette (mirrors src/sidepanel.css)
const SLATE_900 = "#0f172a";
const SLATE_700 = "#334155";
const SLATE_300 = "#cbd5e1";
const WHITE = "#ffffff";

const inputBuffer = readFileSync(inputArg);
const meta = await sharp(inputBuffer).metadata();
const srcW = meta.width;
const srcH = meta.height;

// Scale the screenshot to fit between the side padding, leaving room above for
// the headline block and below for balanced whitespace.
const HEADLINE_BLOCK_H = 200; // top region reserved for headline + subhead
const FOOTER_H = 60;
const targetContentW = OUT_W - PADDING_X * 2;
const targetContentH = OUT_H - HEADLINE_BLOCK_H - FOOTER_H;
const scale = Math.min(targetContentW / srcW, targetContentH / srcH);
const scaledW = Math.round(srcW * scale);
const scaledH = Math.round(srcH * scale);

// 1. Backdrop: a vertical gradient from near-black slate to slate-900, plus a
//    subtle top vignette. sharp's linear gradient via SVG is crisp and tiny.
const backdrop = Buffer.from(`
<svg width="${OUT_W}" height="${OUT_H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#020617"/>
      <stop offset="55%" stop-color="${SLATE_900}"/>
      <stop offset="100%" stop-color="#020617"/>
    </linearGradient>
    <radialGradient id="glow" cx="50%" cy="38%" r="55%">
      <stop offset="0%" stop-color="#1e293b" stop-opacity="0.9"/>
      <stop offset="100%" stop-color="#1e293b" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${OUT_W}" height="${OUT_H}" fill="url(#bg)"/>
  <rect width="${OUT_W}" height="${OUT_H}" fill="url(#glow)"/>
</svg>`);

// 2. Headline overlay: brand wordmark + headline + subhead, top-aligned.
const wordmarkY = 56;
const headlineY = 120;
const subheadY = 158;
const overlay = Buffer.from(`
<svg width="${OUT_W}" height="${OUT_H}" xmlns="http://www.w3.org/2000/svg" font-family="Segoe UI, Arial, sans-serif">
  <!-- accent bar under the wordmark, ties to the product's primary slate -->
  <rect x="${PADDING_X}" y="${wordmarkY - 28}" width="28" height="4" fill="${SLATE_300}"/>
  <text x="${PADDING_X}" y="${wordmarkY}" fill="${WHITE}" font-size="24" font-weight="700" letter-spacing="0.5">PromptWard</text>
  <text x="${PADDING_X}" y="${headlineY}" fill="${WHITE}" font-size="40" font-weight="700">${escapeXml(HEADLINE)}</text>
  <text x="${PADDING_X}" y="${subheadY}" fill="${SLATE_300}" font-size="20" font-weight="400">${escapeXml(SUBHEAD)}</text>
</svg>`);

// 3. Screenshot: drop the alpha (screenshots here are opaque browser frames)
//    and give the scaled image a thin border + drop shadow via an SVG frame so
//    it reads as a floating window on the backdrop.
const shotNoAlpha = await sharp(inputBuffer).flatten({ background: "#0b1220" }).png().toBuffer();
const frame = Buffer.from(`
<svg width="${scaledW + 24}" height="${scaledH + 24}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <filter id="shadow" x="-10%" y="-10%" width="120%" height="125%">
      <feGaussianBlur in="SourceAlpha" stdDeviation="10"/>
      <feOffset dx="0" dy="8" result="off"/>
      <feComponentTransfer><feFuncA type="linear" slope="0.55"/></feComponentTransfer>
      <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>
  <rect x="10" y="10" width="${scaledW + 4}" height="${scaledH + 4}" rx="6" ry="6"
        fill="${SLATE_900}" stroke="${SLATE_300}" stroke-width="1" filter="url(#shadow)"/>
</svg>`);

// Compose: backdrop -> frame -> screenshot -> headline overlay.
const composeX = Math.round((OUT_W - scaledW) / 2);
const composeY = HEADLINE_BLOCK_H + Math.round((targetContentH - scaledH) / 2);

await sharp(backdrop)
  .composite([
    { input: frame, left: composeX - 12, top: composeY - 12 },
    { input: shotNoAlpha, left: composeX, top: composeY },
    { input: overlay, left: 0, top: 0 }
  ])
  .jpeg({ quality: 88, mozjpeg: true, chromaSubsampling: "4:2:0" })
  .toFile(outputArg);

const out = await sharp(outputArg).metadata();
console.log(`Wrote ${outputArg}  ${out.width}x${out.height} ${out.format}`);

function escapeXml(s) {
  return s.replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" }[c]));
}
