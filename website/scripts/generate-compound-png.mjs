import sharp from "sharp";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const assetOut = path.join(root, "src", "assets", "compound.png");
const publicOut = path.join(root, "public", "compound.png");

const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="640" height="640" viewBox="0 0 640 640" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="orbit" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#22d3ee"/>
      <stop offset="55%" stop-color="#818cf8"/>
      <stop offset="100%" stop-color="#c084fc"/>
    </linearGradient>
    <filter id="glow" x="-40%" y="-40%" width="180%" height="180%">
      <feGaussianBlur stdDeviation="8" result="b"/>
      <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>
  <rect width="640" height="640" rx="128" fill="#0c0c0f"/>
  <rect x="3" y="3" width="634" height="634" rx="125" fill="none" stroke="#27272a" stroke-width="2"/>
  <g opacity="0.9">
    <ellipse cx="320" cy="320" rx="210" ry="210" fill="none" stroke="url(#orbit)" stroke-width="2.5" opacity="0.45"/>
    <line x1="320" y1="320" x2="320" y2="110" stroke="#3f3f46" stroke-width="2" opacity="0.6"/>
    <line x1="320" y1="320" x2="502" y2="425" stroke="#3f3f46" stroke-width="2" opacity="0.6"/>
    <line x1="320" y1="320" x2="138" y2="425" stroke="#3f3f46" stroke-width="2" opacity="0.6"/>
    <circle cx="320" cy="320" r="36" fill="#fafafa" filter="url(#glow)"/>
    <circle cx="320" cy="110" r="22" fill="#22d3ee"/>
    <circle cx="502" cy="425" r="22" fill="#818cf8"/>
    <circle cx="138" cy="425" r="22" fill="#c084fc"/>
  </g>
</svg>`;

const png = await sharp(Buffer.from(svg)).png().toBuffer();
await fs.mkdir(path.dirname(assetOut), { recursive: true });
await fs.mkdir(path.dirname(publicOut), { recursive: true });
await fs.writeFile(assetOut, png);
await fs.writeFile(publicOut, png);
console.log("Wrote", assetOut);
console.log("Wrote", publicOut);
