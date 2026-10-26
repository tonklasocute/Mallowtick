// Generates PWA icons and the standalone mascot SVG into public/.
// Run with `pnpm icons` after changing the artwork. Colors mirror the
// design tokens in src/styles/globals.css.
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const C = {
  mint: "#a7e3c2",
  mintSoft: "#e3f6eb",
  mintDeep: "#237a57",
  cream: "#fff9f0",
  creamDeep: "#fbefdd",
  peach: "#f3d9c0",
  accent: "#ffb6c1",
  ink: "#24403d",
  white: "#ffffff",
};

// Same artwork as src/components/brand/mascot.tsx, on a 64×64 grid.
const mascot = `
  <path d="M32 15 C32 12 32 10 32.5 8" fill="none" stroke="${C.mintDeep}" stroke-width="1.8" stroke-linecap="round"/>
  <ellipse cx="26.5" cy="8" rx="5.2" ry="3" transform="rotate(-25 26.5 8)" fill="${C.mint}" stroke="${C.mintDeep}" stroke-width="1.2"/>
  <ellipse cx="38" cy="7" rx="5.2" ry="3" transform="rotate(20 38 7)" fill="${C.mint}" stroke="${C.mintDeep}" stroke-width="1.2"/>
  <rect x="11" y="15" width="42" height="43" rx="16" fill="${C.white}" stroke="${C.peach}" stroke-width="2"/>
  <path d="M15 46 C20 54 44 54 49 46 L49 44 C49 52 15 52 15 44 Z" fill="${C.creamDeep}"/>
  <circle cx="25" cy="35" r="2.8" fill="${C.ink}"/>
  <circle cx="39" cy="35" r="2.8" fill="${C.ink}"/>
  <circle cx="26" cy="34" r="0.9" fill="${C.white}"/>
  <circle cx="40" cy="34" r="0.9" fill="${C.white}"/>
  <path d="M29 40.5 Q32 43.5 35 40.5" fill="none" stroke="${C.ink}" stroke-width="1.8" stroke-linecap="round"/>
  <ellipse cx="19.5" cy="40.5" rx="3.4" ry="2.1" fill="${C.accent}" opacity="0.75"/>
  <ellipse cx="44.5" cy="40.5" rx="3.4" ry="2.1" fill="${C.accent}" opacity="0.75"/>`;

const trendArrow = `
  <polyline points="300,150 345,118 372,132 420,88" fill="none" stroke="${C.mintDeep}" stroke-width="16" stroke-linecap="round" stroke-linejoin="round"/>
  <polyline points="388,84 424,84 424,120" fill="none" stroke="${C.mintDeep}" stroke-width="16" stroke-linecap="round" stroke-linejoin="round"/>`;

/** 512×512 full-bleed icon. `scale` shrinks the artwork for maskable safe zones. */
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

const favicon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="14" fill="${C.mint}"/>
  <g transform="translate(6 7) scale(0.8125)">${mascot}</g>
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
