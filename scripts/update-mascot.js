#!/usr/bin/env node
'use strict';

// Rebuild the embedded terminal sprite from the canonical transparent artwork.
// Usage: node scripts/update-mascot.js
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { decodePNG } = require('../lib/images');

const root = path.join(__dirname, '..');
const image = decodePNG(fs.readFileSync(path.join(root, 'docs', 'mascot.png')));
if (!image) throw new Error('docs/mascot.png must be a supported, non-interlaced PNG');
const size = 64;
const pixels = Buffer.alloc(size * size * 4);
// Area averaging with premultiplied alpha preserves transparency and avoids dark outlines.
for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
  const x0 = Math.floor(x * image.w / size), x1 = Math.max(x0 + 1, Math.floor((x + 1) * image.w / size));
  const y0 = Math.floor(y * image.h / size), y1 = Math.max(y0 + 1, Math.floor((y + 1) * image.h / size));
  let a = 0, r = 0, g = 0, b = 0, count = 0;
  for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) {
    const i = (yy * image.w + xx) * 4, alpha = image.rgba[i + 3];
    a += alpha; r += image.rgba[i] * alpha; g += image.rgba[i + 1] * alpha; b += image.rgba[i + 2] * alpha; count++;
  }
  if (a) { const i = (y * size + x) * 4; pixels[i] = Math.round(r / a); pixels[i + 1] = Math.round(g / a); pixels[i + 2] = Math.round(b / a); pixels[i + 3] = Math.round(a / count); }
}
const chunks = zlib.deflateSync(pixels).toString('base64').match(/.{1,100}/g);
const file = path.join(root, 'lib', 'mascot.js');
const source = fs.readFileSync(file, 'utf8');
const pattern = /const PIXELS = zlib\.inflateSync\(Buffer\.from\([\s\S]*?'base64'\)\); \/\/ RGBA, 4 bytes por p[ií]xel/;
if (!pattern.test(source)) throw new Error('Embedded mascot block not found');
fs.writeFileSync(file, source.replace(pattern, "const PIXELS = zlib.inflateSync(Buffer.from(\n" + chunks.map(c => "  '" + c + "'").join(' +\n') + ", 'base64')); // RGBA, 4 bytes por pixel"));
console.log(`Embedded ${size}x${size} RGBA sprite rebuilt from ${image.w}x${image.h} artwork`);
