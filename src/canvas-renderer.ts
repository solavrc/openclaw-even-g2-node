import type { CanvasImagePayload } from "./canvas-command";
import type { ConnectionGuidance } from "./connection-guidance";
import {
  GLASS_CANVAS_HEIGHT,
  GLASS_CANVAS_IMAGE_CONTAINER_BASE_ID,
  GLASS_CANVAS_TILE_HEIGHT,
  GLASS_CANVAS_TILE_WIDTH,
  GLASS_CANVAS_WIDTH,
} from "./glass-renderer";
import type { GlassImageTile } from "./glass-renderer";
import { glassStatusFrame, shortText } from "./glass";
import openClawLogoUrl from "./assets/openclaw-logo.png";

export type OpenClawAskCanvasOptions = {
  ask: string;
  header: string;
  hint?: string;
};

export type CanvasTutorialStep = 0 | 1 | 2;

export const CANVAS_TUTORIAL_REQUEST = "Hey Claw, create a tiny visual surprise for my Even G2 glasses.";
export const CANVAS_TUTORIAL_FRAMES_MS = [1200, 1400, 0] as const;
export const CANVAS_IMAGE_MAX_SOURCE_PIXELS = GLASS_CANVAS_WIDTH * GLASS_CANVAS_HEIGHT * 16;

export class CanvasImageSourceTooLargeError extends Error {
  constructor(
    readonly sourcePixels: number,
    readonly maxPixels: number,
  ) {
    super(`Canvas image source is too large. Send an image with no more than ${maxPixels} decoded pixels.`);
    this.name = "CanvasImageSourceTooLargeError";
  }
}

export function canvasTutorialFrameDelayMs(step: CanvasTutorialStep) {
  return CANVAS_TUTORIAL_FRAMES_MS[step];
}

export function nextCanvasTutorialStep(step: CanvasTutorialStep): CanvasTutorialStep {
  return Math.min(2, step + 1) as CanvasTutorialStep;
}

export function shouldRenderCanvasTutorialFrame(input: {
  generation: number;
  currentGeneration: number;
  completed: boolean;
}) {
  return input.generation === input.currentGeneration && !input.completed;
}

export function canvasImageFitRect(sourceWidth: number, sourceHeight: number) {
  if (!sourceWidth || !sourceHeight) throw new Error("Canvas image has no dimensions.");
  const scale = Math.min(GLASS_CANVAS_WIDTH / sourceWidth, GLASS_CANVAS_HEIGHT / sourceHeight);
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  return {
    x: Math.floor((GLASS_CANVAS_WIDTH - width) / 2),
    y: Math.floor((GLASS_CANVAS_HEIGHT - height) / 2),
    width,
    height,
  };
}

export function assertCanvasImageSourceSize(sourceWidth: number, sourceHeight: number) {
  if (!sourceWidth || !sourceHeight) throw new Error("Canvas image has no dimensions.");
  const sourcePixels = sourceWidth * sourceHeight;
  if (sourcePixels > CANVAS_IMAGE_MAX_SOURCE_PIXELS) {
    throw new CanvasImageSourceTooLargeError(sourcePixels, CANVAS_IMAGE_MAX_SOURCE_PIXELS);
  }
}

export function canvasImageTilePlans() {
  return [0, 1, 2, 3].map((tileIndex) => {
    const tileX = tileIndex % 2;
    const tileY = Math.floor(tileIndex / 2);
    return {
      id: GLASS_CANVAS_IMAGE_CONTAINER_BASE_ID + tileIndex,
      name: `canvas-image-${tileIndex}`,
      x: tileX * GLASS_CANVAS_TILE_WIDTH,
      y: tileY * GLASS_CANVAS_TILE_HEIGHT,
      sourceX: tileX * GLASS_CANVAS_TILE_WIDTH,
      sourceY: tileY * GLASS_CANVAS_TILE_HEIGHT,
      width: GLASS_CANVAS_TILE_WIDTH,
      height: GLASS_CANVAS_TILE_HEIGHT,
    };
  });
}

export function openClawAskPreviewText(options: OpenClawAskCanvasOptions) {
  return [
    options.header,
    "",
    "Ask OpenClaw with:",
    `"${options.ask}"`,
    "",
    options.hint || "",
  ].filter(Boolean).join("\n");
}

export function openClawAskFallbackFrame(options: OpenClawAskCanvasOptions) {
  return glassStatusFrame(
    options.header,
    ["Ask OpenClaw with:", `"${options.ask}"`].join("\n"),
    options.hint || "ask OpenClaw",
  );
}

function svgCanvasDataUrl(svg: string) {
  return `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;
}

let openClawLogoImagePromise: Promise<HTMLImageElement> | null = null;

function loadImageElement(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Could not load image asset: ${src}`));
    image.src = src;
  });
}

function openClawLogoImage() {
  openClawLogoImagePromise ||= loadImageElement(openClawLogoUrl);
  return openClawLogoImagePromise;
}

function drawWrappedCanvasText(
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
  maxLines = 4,
) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (context.measureText(candidate).width <= maxWidth || !line) {
      line = candidate;
      continue;
    }
    lines.push(line);
    line = word;
    if (lines.length >= maxLines) break;
  }
  if (line && lines.length < maxLines) lines.push(line);
  lines.slice(0, maxLines).forEach((value, index) => {
    context.fillText(value, x, y + index * lineHeight);
  });
}

export async function openClawAskCanvasDataUrl({ ask, header, hint = "" }: OpenClawAskCanvasOptions) {
  const canvas = document.createElement("canvas");
  canvas.width = GLASS_CANVAS_WIDTH;
  canvas.height = GLASS_CANVAS_HEIGHT;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Could not prepare OpenClaw ask canvas.");

  context.clearRect(0, 0, GLASS_CANVAS_WIDTH, GLASS_CANVAS_HEIGHT);
  context.fillStyle = "black";
  context.fillRect(0, 0, GLASS_CANVAS_WIDTH, GLASS_CANVAS_HEIGHT);

  const logo = await openClawLogoImage();
  context.save();
  context.globalAlpha = 0.26;
  context.drawImage(logo, 226, 174, 322, 66);
  context.restore();

  context.fillStyle = "white";
  context.textBaseline = "top";
  context.font = "18px monospace";
  context.fillText(shortText(header, 34), 36, 34);

  context.font = "20px monospace";
  context.fillText("Ask OpenClaw with:", 36, 84);

  context.font = "18px monospace";
  drawWrappedCanvasText(context, `"${ask}"`, 36, 122, 448, 28, 4);

  if (hint) {
    context.font = "16px monospace";
    context.fillText(shortText(hint, 48), 36, 252);
  }

  return canvas.toDataURL("image/png");
}

export function heyClawAskFromText(text: string) {
  return text.match(/"(Hey Claw,[^"]+)"/i)?.[1] || "";
}

export function heyClawAskFromGuidance(guidance: ConnectionGuidance) {
  return heyClawAskFromText([
    guidance.title,
    guidance.body,
    guidance.action || "",
  ].join("\n"));
}

export function canvasTutorialImageDataUrl(step: 0 | 1) {
  if (step === 0) {
    return svgCanvasDataUrl(`<svg xmlns="http://www.w3.org/2000/svg" width="576" height="288" viewBox="0 0 576 288">
<rect width="576" height="288" fill="black"/>
<g fill="white" opacity="0.92">
<circle cx="72" cy="44" r="2"/><circle cx="118" cy="82" r="1.5"/><circle cx="176" cy="38" r="1.5"/><circle cx="246" cy="70" r="2"/><circle cx="332" cy="42" r="1.6"/><circle cx="420" cy="78" r="2"/><circle cx="502" cy="48" r="1.4"/>
<circle cx="96" cy="212" r="1.5"/><circle cx="188" cy="240" r="2"/><circle cx="286" cy="218" r="1.4"/><circle cx="386" cy="242" r="1.8"/><circle cx="488" cy="210" r="1.5"/>
</g>
<path d="M108 178 C164 110 246 94 288 132 C330 94 412 110 468 178" fill="none" stroke="white" stroke-width="4" stroke-linecap="round"/>
<path d="M188 174 C206 130 246 116 288 144 C330 116 370 130 388 174" fill="none" stroke="white" stroke-width="3" stroke-linecap="round"/>
<path d="M245 168 L212 208 M331 168 L364 208" stroke="white" stroke-width="4" stroke-linecap="round"/>
<circle cx="252" cy="150" r="6" fill="white"/><circle cx="324" cy="150" r="6" fill="white"/>
<text x="288" y="268" text-anchor="middle" font-family="monospace" font-size="22" fill="white">OpenClaw can draw on your glasses.</text>
</svg>`);
  }
  return svgCanvasDataUrl(`<svg xmlns="http://www.w3.org/2000/svg" width="576" height="288" viewBox="0 0 576 288">
<rect width="576" height="288" fill="black"/>
<rect x="36" y="34" width="504" height="220" rx="10" fill="none" stroke="white" stroke-width="3"/>
<path d="M68 78 H508 M68 122 H352 M68 166 H464 M68 210 H292" stroke="white" stroke-width="5" stroke-linecap="round" opacity="0.9"/>
<path d="M420 122 L464 166 L420 210" fill="none" stroke="white" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>
<circle cx="120" cy="78" r="9" fill="white"/><circle cx="172" cy="122" r="7" fill="white"/><circle cx="228" cy="166" r="8" fill="white"/>
<text x="288" y="278" text-anchor="middle" font-family="monospace" font-size="20" fill="white">Send text. Send images. Keep looking forward.</text>
</svg>`);
}

export async function canvasImagePayloadToTiles(payload: CanvasImagePayload): Promise<GlassImageTile[]> {
  const image = new Image();
  const loaded = new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("Could not decode canvas image."));
  });
  image.src = payload.dataUrl;
  await loaded;

  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  assertCanvasImageSourceSize(sourceWidth, sourceHeight);
  const fit = canvasImageFitRect(sourceWidth, sourceHeight);

  const canvas = document.createElement("canvas");
  canvas.width = GLASS_CANVAS_WIDTH;
  canvas.height = GLASS_CANVAS_HEIGHT;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Could not prepare canvas image.");

  context.clearRect(0, 0, GLASS_CANVAS_WIDTH, GLASS_CANVAS_HEIGHT);
  context.drawImage(image, fit.x, fit.y, fit.width, fit.height);

  return canvasImageTilePlans().map((tile) => {
    const tileCanvas = document.createElement("canvas");
    tileCanvas.width = tile.width;
    tileCanvas.height = tile.height;
    const tileContext = tileCanvas.getContext("2d");
    if (!tileContext) throw new Error("Could not prepare canvas image tile.");
    tileContext.drawImage(
      canvas,
      tile.sourceX,
      tile.sourceY,
      tile.width,
      tile.height,
      0,
      0,
      tile.width,
      tile.height,
    );
    return {
      id: tile.id,
      name: tile.name,
      x: tile.x,
      y: tile.y,
      imageData: tileCanvas.toDataURL("image/png").split(",")[1] || "",
    };
  });
}
