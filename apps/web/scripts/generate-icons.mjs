// Generates PWA icons and the standalone mascot SVG into public/.
// Run with `pnpm icons` after changing the artwork. Colors mirror the
// design tokens in src/styles/globals.css (including its `@theme static` block).
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const C = {
  mint: "#a7e3c2", // --color-mint
  mintSoft: "#e2f5eb", // --color-mint-soft
  mintDeep: "#17704c", // --color-mint-deep
  candleUp: "#25a874", // --color-candle-up
  accent: "#ffb6c1", // --color-accent
  ink: "#1d3b32", // --color-ink
  line: "#f0e5d6", // --color-line
  surface: "#ffffff", // --color-surface
};

// Same artwork as src/components/brand/mascot.tsx, on its 64×64 grid: a white body
// with a dark outline and a two-leaf sprout. The left leaf is mint without an
// outline, so it needs the lighter mint-soft behind it to show.
const mascot = `
  <path d="M32 16 C32 10 30 7 27 5" fill="none" stroke="${C.candleUp}" stroke-width="3" stroke-linecap="round"/>
  <path d="M30 9 C24 3 16 5 15 10 C21 13 27 12 30 9 Z" fill="${C.mint}"/>
  <path d="M31 10 C35 3 43 3 46 7 C41 12 35 13 31 10 Z" fill="${C.candleUp}"/>
  <rect x="10" y="16" width="44" height="42" rx="18" fill="${C.surface}" stroke="${C.ink}" stroke-width="2.5"/>
  <path d="M16.5 27.6 Q17.8 21.2 24.2 19.2" fill="none" stroke="${C.line}" stroke-width="2.6" stroke-linecap="round"/>
  <circle cx="24" cy="36" r="3" fill="${C.ink}"/>
  <circle cx="40" cy="36" r="3" fill="${C.ink}"/>
  <circle cx="25" cy="35" r="0.9" fill="${C.surface}"/>
  <circle cx="41" cy="35" r="0.9" fill="${C.surface}"/>
  <ellipse cx="18" cy="43" rx="4" ry="2.6" fill="${C.accent}"/>
  <ellipse cx="46" cy="43" rx="4" ry="2.6" fill="${C.accent}"/>
  <path d="M28 43 Q32 47 36 43" fill="none" stroke="${C.ink}" stroke-width="2.4" stroke-linecap="round"/>`;

const trendArrow = `
  <polyline points="300,150 345,118 372,132 420,88" fill="none" stroke="${C.mintDeep}" stroke-width="16" stroke-linecap="round" stroke-linejoin="round"/>
  <polyline points="388,84 424,84 424,120" fill="none" stroke="${C.mintDeep}" stroke-width="16" stroke-linecap="round" stroke-linejoin="round"/>`;

/**
 * 512×512 full-bleed icon. `scale` shrinks the artwork towards the centre for
 * maskable icons, whose safe zone is the centre circle of radius 40% (204.8px).
 */
function appIcon(scale = 1) {
  const mascotSize = 300 * scale;
  const offset = (512 - mascotSize) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="${C.mint}"/>
  <circle cx="256" cy="282" r="${190 * scale}" fill="${C.mintSoft}"/>
  <g transform="translate(256 256) scale(${scale}) translate(-256 -256)">${trendArrow}</g>
  <g transform="translate(${offset} ${offset + 26 * scale}) scale(${mascotSize / 64})">${mascot}</g>
</svg>`;
}

// Mint-soft tile with a mint edge: the mascot's mint leaf would vanish on plain mint.
// The mascot fills most of the tile so it still reads at 16px.
const favicon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect x="1" y="1" width="62" height="62" rx="14" fill="${C.mintSoft}" stroke="${C.mint}" stroke-width="2"/>
  <g transform="translate(2.5 3) scale(0.92)">${mascot}</g>
</svg>`;

const standaloneMascot = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${mascot}</svg>`;

const out = (p) => fileURLToPath(new URL(`../public/${p}`, import.meta.url));

await mkdir(out("icons"), { recursive: true });
await mkdir(out("mascot"), { recursive: true });

const targets = [
  ["icons/icon-192.png", appIcon(), 192],
  ["icons/icon-512.png", appIcon(), 512],
  ["icons/icon-maskable-512.png", appIcon(0.78), 512],
  ["icons/apple-touch-icon.png", appIcon(), 180],
];
for (const [path, svg, size] of targets) {
  await sharp(Buffer.from(svg)).resize(size, size).png({ compressionLevel: 9 }).toFile(out(path));
}
await writeFile(out("icons/favicon.svg"), favicon);
await writeFile(out("mascot/mallow.svg"), standaloneMascot);
console.log("Icons written to public/icons and public/mascot");
