import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

export type ParsedRgbaPng = {
  alpha: Buffer;
  colorType: number;
  height: number;
  interlace: number;
  rgba: Buffer;
  width: number;
};

export type SimulatorCapture = {
  alphaPath: string;
  baseUrl: string;
  glassesPath: string;
  height: number;
  litPixels: number;
  reviewPath: string;
  webviewDarkPixels: number;
  webviewHeight: number;
  webviewLitPixels: number;
  webviewPath: string;
  webviewWidth: number;
  width: number;
};

export function simulatorUnavailableMessage(url: string, err: unknown): string {
  const detail = err instanceof Error ? err.message : String(err);
  return [
    `Even Hub simulator is not reachable at ${url}: ${detail}`,
    "Start it with:",
    "  pnpm build",
    "  pnpm serve:sim",
    "  pnpm sim:run",
  ].join("\n");
}

export async function fetchSimulator(baseUrl: string, pathName: string, init?: RequestInit): Promise<Response> {
  const url = `${baseUrl}${pathName}`;
  try {
    return await fetch(url, init);
  } catch (err) {
    throw new Error(simulatorUnavailableMessage(url, err));
  }
}

function consoleEntryText(entry: unknown): string {
  if (typeof entry === "string") return entry;
  if (!entry || typeof entry !== "object") return "";
  const record = entry as Record<string, unknown>;
  const message = record.message ?? record.text ?? record.value ?? record.args;
  if (Array.isArray(message)) return message.map(consoleEntryText).filter(Boolean).join(" ");
  if (typeof message === "string") return message;
  try {
    return JSON.stringify(entry);
  } catch {
    return String(entry);
  }
}

export async function simulatorConsoleText(baseUrl: string) {
  const res = await fetchSimulator(baseUrl, "/api/console");
  if (!res.ok) throw new Error(`${baseUrl}/api/console returned ${res.status}`);
  const body = await res.json() as unknown;
  const entries = Array.isArray(body)
    ? body
    : body && typeof body === "object" && Array.isArray((body as Record<string, unknown>).entries)
      ? (body as Record<string, unknown>).entries as unknown[]
      : body && typeof body === "object" && Array.isArray((body as Record<string, unknown>).logs)
        ? (body as Record<string, unknown>).logs as unknown[]
        : [body];
  return entries.map(consoleEntryText).filter(Boolean).join("\n");
}

async function getBuffer(baseUrl: string, pathName: string) {
  const res = await fetchSimulator(baseUrl, pathName);
  if (!res.ok) throw new Error(`${baseUrl}${pathName} returned ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

export function parseRgbaPng(png: Buffer): ParsedRgbaPng {
  if (!png.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    throw new Error("Expected PNG input");
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
  if (bitDepth !== 8 || colorType !== 6 || interlace !== 0) {
    throw new Error(`Expected 8-bit non-interlaced RGBA PNG, got bitDepth=${bitDepth} colorType=${colorType} interlace=${interlace}`);
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const bytesPerPixel = 4;
  const stride = width * bytesPerPixel;
  let offset = 0;
  let previous = Buffer.alloc(stride);
  const alpha = Buffer.alloc(width * height);
  const rgba = Buffer.alloc(width * height * bytesPerPixel);
  let alphaOffset = 0;
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
        throw new Error(`Unsupported PNG filter ${filter}`);
      }
      row[x] = (source[x] + predictor) & 0xff;
    }
    for (let x = 3; x < stride; x += bytesPerPixel) {
      alpha[alphaOffset] = row[x];
      alphaOffset += 1;
    }
    row.copy(rgba, y * stride);
    previous = row;
  }
  return { alpha, colorType, height, interlace, rgba, width };
}

export function writePgm(filePath: string, width: number, height: number, pixels: Buffer) {
  fs.writeFileSync(filePath, Buffer.concat([
    Buffer.from(`P5\n${width} ${height}\n255\n`),
    pixels,
  ]));
}

const CRC_TABLE = new Uint32Array(256);
for (let index = 0; index < CRC_TABLE.length; index += 1) {
  let crc = index;
  for (let bit = 0; bit < 8; bit += 1) {
    crc = (crc & 1) ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  CRC_TABLE[index] = crc >>> 0;
}

function crc32(buffers: Buffer[]): number {
  let crc = 0xffffffff;
  for (const buffer of buffers) {
    for (const byte of buffer) {
      crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBuffer = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32([typeBuffer, data]));
  return Buffer.concat([length, typeBuffer, data, crc]);
}

export function writeRgbaPng(filePath: string, width: number, height: number, rgba: Buffer) {
  const bytesPerPixel = 4;
  const stride = width * bytesPerPixel;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const targetOffset = y * (stride + 1);
    raw[targetOffset] = 0;
    rgba.copy(raw, targetOffset + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  fs.writeFileSync(filePath, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", zlib.deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]));
}

export function makeAlphaReviewRgba(alpha: Buffer): Buffer {
  const rgba = Buffer.alloc(alpha.length * 4);
  for (let index = 0; index < alpha.length; index += 1) {
    const lit = alpha[index] > 0;
    const offset = index * 4;
    rgba[offset] = lit ? 38 : 0;
    rgba[offset + 1] = lit ? 255 : 0;
    rgba[offset + 2] = lit ? 92 : 0;
    rgba[offset + 3] = 255;
  }
  return rgba;
}

export function countLitPixels(alpha: Buffer) {
  return alpha.reduce((sum, value) => sum + (value > 0 ? 1 : 0), 0);
}

export function countDarkPixels(rgba: Buffer) {
  let count = 0;
  for (let index = 0; index < rgba.length; index += 4) {
    const alpha = rgba[index + 3];
    const luma = 0.2126 * rgba[index] + 0.7152 * rgba[index + 1] + 0.0722 * rgba[index + 2];
    if (alpha > 0 && luma < 180) count += 1;
  }
  return count;
}

export async function captureSimulator(baseUrl: string, outDir: string, label = "capture"): Promise<SimulatorCapture> {
  const ping = await fetchSimulator(baseUrl, "/api/ping");
  if (!ping.ok) throw new Error(`Simulator ping failed: ${ping.status}`);
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const safeLabel = label.replace(/[^a-z0-9_-]+/gi, "-").replace(/^-|-$/g, "") || "capture";
  const glassesPath = path.join(outDir, `even-g2-${safeLabel}-glasses-${stamp}.png`);
  const webviewPath = path.join(outDir, `even-g2-${safeLabel}-webview-${stamp}.png`);
  const alphaPath = path.join(outDir, `even-g2-${safeLabel}-glasses-alpha-${stamp}.pgm`);
  const reviewPath = path.join(outDir, `even-g2-${safeLabel}-glasses-review-${stamp}.png`);
  const glasses = await getBuffer(baseUrl, "/api/screenshot/glasses");
  const webview = await getBuffer(baseUrl, "/api/screenshot/webview");
  fs.writeFileSync(glassesPath, glasses);
  fs.writeFileSync(webviewPath, webview);
  const { width, height, alpha } = parseRgbaPng(glasses);
  const webviewImage = parseRgbaPng(webview);
  writePgm(alphaPath, width, height, alpha);
  writeRgbaPng(reviewPath, width, height, makeAlphaReviewRgba(alpha));
  return {
    alphaPath,
    baseUrl,
    glassesPath,
    height,
    litPixels: countLitPixels(alpha),
    reviewPath,
    webviewDarkPixels: countDarkPixels(webviewImage.rgba),
    webviewHeight: webviewImage.height,
    webviewLitPixels: countLitPixels(webviewImage.alpha),
    webviewPath,
    webviewWidth: webviewImage.width,
    width,
  };
}

export function assertCaptureLooksVisible(capture: SimulatorCapture) {
  if (capture.width !== 576 || capture.height !== 288) {
    throw new Error(`Unexpected glasses screenshot size ${capture.width}x${capture.height}; expected 576x288`);
  }
  if (capture.litPixels < 500) {
    throw new Error(`Glasses screenshot looks blank: litPixels=${capture.litPixels}`);
  }
  if (capture.webviewWidth < 300 || capture.webviewHeight < 500) {
    throw new Error(`Unexpected webview screenshot size ${capture.webviewWidth}x${capture.webviewHeight}`);
  }
  if (capture.webviewLitPixels < 10_000 || capture.webviewDarkPixels < 1_000) {
    throw new Error(`Webview screenshot looks blank: litPixels=${capture.webviewLitPixels} darkPixels=${capture.webviewDarkPixels}`);
  }
}

export async function sendSimulatorInput(baseUrl: string, action: "click" | "double_click" | "up" | "down") {
  const res = await fetchSimulator(baseUrl, "/api/input", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action }),
  });
  if (!res.ok) throw new Error(`Simulator input ${action} failed: ${res.status} ${await res.text()}`);
}
