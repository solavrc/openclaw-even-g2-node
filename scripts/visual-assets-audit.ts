import fs from "node:fs";
import zlib from "node:zlib";
import { errorStack } from "./strict-helpers.ts";

type DecodedPng = {
  width: number;
  height: number;
  bytesPerPixel: number;
  pixels: Buffer;
};

const EVEN_HUB_ICON_24_PATH = "openclaw-node-evenhub-icon-24.png";

function decodePng(filePath: string): DecodedPng {
  const png = fs.readFileSync(filePath);
  if (!png.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    throw new Error(`${filePath} is not a PNG`);
  }
  let pos = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const idat: Buffer[] = [];
  while (pos < png.length) {
    const length = png.readUInt32BE(pos);
    pos += 4;
    const type = png.toString("ascii", pos, pos + 4);
    pos += 4;
    const chunk = png.subarray(pos, pos + length);
    pos += length + 4;
    if (type === "IHDR") {
      width = chunk.readUInt32BE(0);
      height = chunk.readUInt32BE(4);
      bitDepth = chunk[8];
      colorType = chunk[9];
      interlace = chunk[12];
    } else if (type === "IDAT") {
      idat.push(chunk);
    } else if (type === "IEND") {
      break;
    }
  }
  if (bitDepth !== 8 || ![0, 2, 6].includes(colorType) || interlace !== 0) {
    throw new Error(`${filePath} must be 8-bit non-interlaced grayscale/RGB/RGBA PNG, got bitDepth=${bitDepth} colorType=${colorType} interlace=${interlace}`);
  }
  const bytesPerPixel = colorType === 6 ? 4 : colorType === 2 ? 3 : 1;
  const stride = width * bytesPerPixel;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const pixels = Buffer.alloc(width * height * bytesPerPixel);
  let offset = 0;
  let previous = Buffer.alloc(stride);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[offset];
    offset += 1;
    const source = raw.subarray(offset, offset + stride);
    offset += stride;
    const row = Buffer.alloc(stride);
    for (let x = 0; x < stride; x += 1) {
      const left = x >= bytesPerPixel ? row[x - bytesPerPixel] : 0;
      const up = previous[x];
      const upLeft = x >= bytesPerPixel ? previous[x - bytesPerPixel] : 0;
      let predictor = 0;
      if (filter === 1) predictor = left;
      else if (filter === 2) predictor = up;
      else if (filter === 3) predictor = Math.floor((left + up) / 2);
      else if (filter === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        predictor = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
      } else if (filter !== 0) {
        throw new Error(`${filePath} uses unsupported PNG filter ${filter}`);
      }
      row[x] = (source[x] + predictor) & 0xff;
    }
    row.copy(pixels, y * stride);
    previous = row;
  }
  return { width, height, bytesPerPixel, pixels };
}

function auditEvenHubIcon24(filePath: string): string[] {
  const image = decodePng(filePath);
  const findings: string[] = [];
  if (image.width !== 24 || image.height !== 24) {
    findings.push(`${filePath} must be 24x24; got ${image.width}x${image.height}`);
  }
  if (image.bytesPerPixel !== 4) {
    findings.push(`${filePath} must be RGBA so transparent background is preserved.`);
  }
  let foregroundPixels = 0;
  let nonMonochromePixels = 0;
  for (let offset = 0; offset < image.pixels.length; offset += image.bytesPerPixel) {
    const alpha = image.bytesPerPixel === 4 ? image.pixels[offset + 3] : 255;
    if (alpha === 0) continue;
    foregroundPixels += 1;
    const r = image.pixels[offset];
    const g = image.bytesPerPixel === 1 ? r : image.pixels[offset + 1];
    const b = image.bytesPerPixel === 1 ? r : image.pixels[offset + 2];
    if (r !== 0 || g !== 0 || b !== 0 || alpha !== 255) nonMonochromePixels += 1;
  }
  if (foregroundPixels < 32) findings.push(`${filePath} needs enough foreground pixels for legibility; foregroundPixels=${foregroundPixels}`);
  if (foregroundPixels > 180) findings.push(`${filePath} has too many foreground pixels for a 24x24 line icon; foregroundPixels=${foregroundPixels}`);
  if (nonMonochromePixels > 0) findings.push(`${filePath} must use only opaque black pixels plus transparent background; nonMonochromePixels=${nonMonochromePixels}`);
  return findings;
}

function main(): void {
  const findings = [
    ...auditEvenHubIcon24(EVEN_HUB_ICON_24_PATH),
  ];
  if (findings.length) throw new Error(`Visual asset audit failed:\n${findings.map((finding) => `- ${finding}`).join("\n")}`);
  console.log(JSON.stringify({ ok: true, evenHubIcon24: EVEN_HUB_ICON_24_PATH }));
}

try {
  main();
} catch (err) {
  console.error(errorStack(err));
  process.exit(1);
}
