import {
  CreateStartUpPageContainer,
  EvenAppBridge,
  ImageContainerProperty,
  ImageRawDataUpdate,
  ImageRawDataUpdateResult,
  RebuildPageContainer,
  TextContainerProperty,
  TextContainerUpgrade,
} from "@evenrealities/even_hub_sdk";
import { normalizeGlassHudFrame, shortText } from "./glass";
import type { GlassHudFrame, GlassHudFrameInput } from "./glass";

export const GLASS_CANVAS_WIDTH = 576;
export const GLASS_CANVAS_HEIGHT = 288;
export const GLASS_CANVAS_TILE_WIDTH = 288;
export const GLASS_CANVAS_TILE_HEIGHT = 144;
export const GLASS_CANVAS_IMAGE_CONTAINER_BASE_ID = 10;

const GLASS_HEADER_TEXT_CONTAINER_ID = 1;
const GLASS_HEADER_TEXT_CONTAINER_NAME = "header";
const GLASS_BODY_TEXT_CONTAINER_ID = 2;
const GLASS_BODY_TEXT_CONTAINER_NAME = "body";
const GLASS_HINT_TEXT_CONTAINER_ID = 3;
const GLASS_HINT_TEXT_CONTAINER_NAME = "hint";
const GLASS_IMAGE_CAPTURE_CONTAINER_ID = 99;
const GLASS_IMAGE_CAPTURE_CONTAINER_NAME = "image-capture";

export type GlassRenderInput = string | GlassHudFrameInput;

export type GlassVoicePanelFrame = {
  base: GlassHudFrame;
  title: string;
  body: string;
  hint: string;
};

export type GlassImageTile = {
  id: number;
  name: string;
  x: number;
  y: number;
  imageData: string;
};

type GlassTextBridge = Pick<EvenAppBridge, "createStartUpPageContainer" | "rebuildPageContainer" | "textContainerUpgrade">;
type GlassImageBridge = Pick<EvenAppBridge, "createStartUpPageContainer" | "rebuildPageContainer" | "updateImageRawData">;
type GlassLayoutName = "text-frame" | "voice-panel" | "canvas-image";
type StatefulTextBridge = GlassTextBridge & {
  __openClawEvenG2GlassPageCreated?: boolean;
  __openClawEvenG2GlassLayout?: GlassLayoutName;
  __openClawEvenG2GlassTextContents?: Record<string, string>;
};
type StatefulImageBridge = GlassImageBridge & {
  __openClawEvenG2GlassPageCreated?: boolean;
  __openClawEvenG2GlassLayout?: GlassLayoutName;
  __openClawEvenG2GlassTextContents?: Record<string, string>;
};

function devLog(...args: unknown[]) {
  if (import.meta.env.DEV) globalThis["console"].info(...args);
}

export function displayTextForGlass(text: string) {
  return text
    .replace(/`/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function parseLegacyGlassTextFrame(text: string): GlassHudFrame {
  const lines = displayTextForGlass(text).split("\n");
  const header = lines[0]?.trim() || "OpenClaw Node";
  const hint = lines.length > 2 ? lines[lines.length - 1]?.trim() || "" : "";
  const body = lines.length > 2
    ? lines.slice(1, -1).join("\n").trim()
    : lines.slice(1).join("\n").trim();
  return { header, body, hint };
}

export function glassFrameFromInput(input: GlassRenderInput): GlassHudFrame {
  return typeof input === "string" ? parseLegacyGlassTextFrame(input) : normalizeGlassHudFrame(input);
}

function rightAlignHeaderHint(hint: string) {
  const clean = hint.trim();
  if (!clean) return "";
  const targetChars = 30;
  return `${" ".repeat(Math.max(0, targetChars - clean.length))}${clean}`;
}

function glassFrameTextObject(frame: GlassHudFrame) {
  return [
    glassTextContainer({
      id: GLASS_HEADER_TEXT_CONTAINER_ID,
      name: GLASS_HEADER_TEXT_CONTAINER_NAME,
      x: 16,
      y: 12,
      width: 260,
      height: 34,
      content: frame.header,
      padding: 0,
      isEventCapture: 0,
    }),
    glassTextContainer({
      id: GLASS_BODY_TEXT_CONTAINER_ID,
      name: GLASS_BODY_TEXT_CONTAINER_NAME,
      x: 8,
      y: 50,
      width: 560,
      height: 226,
      content: frame.body,
      isEventCapture: 1,
    }),
    glassTextContainer({
      id: GLASS_HINT_TEXT_CONTAINER_ID,
      name: GLASS_HINT_TEXT_CONTAINER_NAME,
      x: 300,
      y: 12,
      width: 260,
      height: 34,
      content: rightAlignHeaderHint(frame.hint),
      padding: 0,
      isEventCapture: 0,
    }),
  ];
}

function glassVoicePanelTextObject(frame: GlassVoicePanelFrame) {
  const panelContent = shortText(frame.body, 260);
  const hintContent = rightAlignHeaderHint(shortText(frame.hint, 44));
  return [
    glassTextContainer({
      id: GLASS_HEADER_TEXT_CONTAINER_ID,
      name: GLASS_HEADER_TEXT_CONTAINER_NAME,
      x: 16,
      y: 12,
      width: 260,
      height: 34,
      content: frame.base.header,
      padding: 0,
      isEventCapture: 0,
    }),
    glassTextContainer({
      id: GLASS_BODY_TEXT_CONTAINER_ID,
      name: GLASS_BODY_TEXT_CONTAINER_NAME,
      x: 8,
      y: 50,
      width: 560,
      height: 226,
      content: panelContent,
      borderWidth: 1,
      borderColor: 5,
      isEventCapture: 1,
    }),
    glassTextContainer({
      id: GLASS_HINT_TEXT_CONTAINER_ID,
      name: GLASS_HINT_TEXT_CONTAINER_NAME,
      x: 300,
      y: 12,
      width: 260,
      height: 34,
      content: hintContent,
      padding: 0,
      isEventCapture: 0,
    }),
  ];
}

function glassTextContainer({
  id,
  name,
  x,
  y,
  width,
  height,
  content,
  padding = 10,
  borderWidth = 0,
  borderColor = 5,
  isEventCapture,
}: {
  id: number;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  content: string;
  padding?: number;
  borderWidth?: number;
  borderColor?: number;
  isEventCapture: 0 | 1;
}) {
  return new TextContainerProperty({
    xPosition: x,
    yPosition: y,
    width,
    height,
    borderWidth,
    borderColor,
    paddingLength: padding,
    containerID: id,
    containerName: name,
    content,
    isEventCapture,
  });
}

async function upgradeGlassText(bridge: GlassTextBridge, id: number, name: string, content: string) {
  const updated = await bridge.textContainerUpgrade(new TextContainerUpgrade({
    containerID: id,
    containerName: name,
    content,
  }));
  devLog("[Even G2] textContainerUpgrade result", updated, { container: name, contentLength: content.length });
  return updated === true;
}

function textContentKey(id: number, name: string) {
  return `${id}:${name}`;
}

function setGlassTextCache(
  bridge: StatefulTextBridge,
  entries: Array<{ id: number; name: string; content: string }>,
) {
  bridge.__openClawEvenG2GlassTextContents = Object.fromEntries(
    entries.map((entry) => [textContentKey(entry.id, entry.name), entry.content]),
  );
}

async function upgradeChangedGlassText(
  bridge: StatefulTextBridge,
  entries: Array<{ id: number; name: string; content: string }>,
) {
  const previous = bridge.__openClawEvenG2GlassTextContents || {};
  const changed = entries.filter((entry) => previous[textContentKey(entry.id, entry.name)] !== entry.content);
  if (!changed.length) return true;

  const updated = await Promise.all(
    changed.map((entry) => upgradeGlassText(bridge, entry.id, entry.name, entry.content)),
  );
  if (!updated.every(Boolean)) return false;

  bridge.__openClawEvenG2GlassTextContents = {
    ...previous,
    ...Object.fromEntries(changed.map((entry) => [textContentKey(entry.id, entry.name), entry.content])),
  };
  return true;
}

function textFrameCacheEntries(frame: GlassHudFrame) {
  return [
    { id: GLASS_HEADER_TEXT_CONTAINER_ID, name: GLASS_HEADER_TEXT_CONTAINER_NAME, content: frame.header },
    { id: GLASS_BODY_TEXT_CONTAINER_ID, name: GLASS_BODY_TEXT_CONTAINER_NAME, content: frame.body },
    { id: GLASS_HINT_TEXT_CONTAINER_ID, name: GLASS_HINT_TEXT_CONTAINER_NAME, content: rightAlignHeaderHint(frame.hint) },
  ];
}

function voicePanelCacheEntries(frame: GlassVoicePanelFrame) {
  return [
    { id: GLASS_HEADER_TEXT_CONTAINER_ID, name: GLASS_HEADER_TEXT_CONTAINER_NAME, content: frame.base.header },
    { id: GLASS_BODY_TEXT_CONTAINER_ID, name: GLASS_BODY_TEXT_CONTAINER_NAME, content: shortText(frame.body, 260) },
    { id: GLASS_HINT_TEXT_CONTAINER_ID, name: GLASS_HINT_TEXT_CONTAINER_NAME, content: rightAlignHeaderHint(shortText(frame.hint, 44)) },
  ];
}

export async function renderGlassTextFrame(bridge: GlassTextBridge | null, frameInput: GlassHudFrame): Promise<boolean> {
  if (!bridge) return false;
  const bridgeWithState = bridge as StatefulTextBridge;
  const frame = normalizeGlassHudFrame(frameInput);
  const layout: GlassLayoutName = "text-frame";
  const cacheEntries = textFrameCacheEntries(frame);
  const page = {
    containerTotalNum: 3,
    textObject: glassFrameTextObject(frame),
  };
  if (!bridgeWithState.__openClawEvenG2GlassPageCreated) {
    const result = await bridge.createStartUpPageContainer(new CreateStartUpPageContainer(page));
    devLog("[Even G2] createStartUpPageContainer result", result, {
      bodyLength: frame.body.length,
      layout,
    });
    if (result !== 0) {
      const ok = await bridge.rebuildPageContainer(new RebuildPageContainer(page));
      devLog("[Even G2] rebuildPageContainer after startup failure result", ok, { layout });
      if (ok !== true) return false;
    }
    bridgeWithState.__openClawEvenG2GlassPageCreated = true;
    bridgeWithState.__openClawEvenG2GlassLayout = layout;
    setGlassTextCache(bridgeWithState, cacheEntries);
    return true;
  }

  if (bridgeWithState.__openClawEvenG2GlassLayout !== layout) {
    const ok = await bridge.rebuildPageContainer(new RebuildPageContainer(page));
    devLog("[Even G2] rebuildPageContainer result", ok, { layout });
    if (ok === true) {
      bridgeWithState.__openClawEvenG2GlassLayout = layout;
      setGlassTextCache(bridgeWithState, cacheEntries);
    }
    return ok === true;
  }

  const updated = await upgradeChangedGlassText(bridge, cacheEntries);
  if (updated) return true;

  const ok = await bridge.rebuildPageContainer(new RebuildPageContainer(page));
  devLog("[Even G2] rebuildPageContainer result", ok, { layout });
  if (ok === true) setGlassTextCache(bridgeWithState, cacheEntries);
  return ok === true;
}

export async function renderGlassImageCanvas(bridge: GlassImageBridge | null, tiles: GlassImageTile[]): Promise<boolean> {
  if (!bridge) return false;
  const bridgeWithState = bridge as StatefulImageBridge;
  const layout: GlassLayoutName = "canvas-image";
  const page = {
    containerTotalNum: 5,
    imageObject: tiles.map((tile) => new ImageContainerProperty({
      xPosition: tile.x,
      yPosition: tile.y,
      width: GLASS_CANVAS_TILE_WIDTH,
      height: GLASS_CANVAS_TILE_HEIGHT,
      containerID: tile.id,
      containerName: tile.name,
    })),
    textObject: [
      glassTextContainer({
        id: GLASS_IMAGE_CAPTURE_CONTAINER_ID,
        name: GLASS_IMAGE_CAPTURE_CONTAINER_NAME,
        x: 0,
        y: 0,
        width: GLASS_CANVAS_WIDTH,
        height: GLASS_CANVAS_HEIGHT,
        content: " ",
        padding: 0,
        isEventCapture: 1,
      }),
    ],
  };
  if (!bridgeWithState.__openClawEvenG2GlassPageCreated) {
    const result = await bridge.createStartUpPageContainer(new CreateStartUpPageContainer(page));
    devLog("[Even G2] create image canvas result", result, { layout });
    if (result !== 0) {
      const ok = await bridge.rebuildPageContainer(new RebuildPageContainer(page));
      devLog("[Even G2] rebuild image canvas after startup failure result", ok, { layout });
      if (ok !== true) return false;
    }
    bridgeWithState.__openClawEvenG2GlassPageCreated = true;
    bridgeWithState.__openClawEvenG2GlassLayout = layout;
  } else if (bridgeWithState.__openClawEvenG2GlassLayout !== layout) {
    const ok = await bridge.rebuildPageContainer(new RebuildPageContainer(page));
    devLog("[Even G2] rebuild image canvas result", ok, { layout });
    if (ok !== true) return false;
    bridgeWithState.__openClawEvenG2GlassLayout = layout;
  }
  bridgeWithState.__openClawEvenG2GlassTextContents = {};

  const updates = await Promise.all(tiles.map((tile) => bridge.updateImageRawData(new ImageRawDataUpdate({
    containerID: tile.id,
    containerName: tile.name,
    imageData: tile.imageData,
  }))));
  devLog("[Even G2] image canvas update results", updates);
  return updates.every((result) => ImageRawDataUpdateResult.isSuccess(result));
}

export async function renderGlassVoicePanelFrame(bridge: GlassTextBridge | null, frame: GlassVoicePanelFrame): Promise<boolean> {
  if (!bridge) return false;
  const bridgeWithState = bridge as StatefulTextBridge;
  const layout: GlassLayoutName = "voice-panel";
  const cacheEntries = voicePanelCacheEntries(frame);
  const page = {
    containerTotalNum: 3,
    textObject: glassVoicePanelTextObject(frame),
  };
  if (!bridgeWithState.__openClawEvenG2GlassPageCreated || bridgeWithState.__openClawEvenG2GlassLayout !== layout) {
    const ok = bridgeWithState.__openClawEvenG2GlassPageCreated
      ? await bridge.rebuildPageContainer(new RebuildPageContainer(page))
      : await bridge.createStartUpPageContainer(new CreateStartUpPageContainer(page));
    devLog("[Even G2] voice panel page result", ok, { layout });
    if (ok !== true && ok !== 0) return false;
    bridgeWithState.__openClawEvenG2GlassPageCreated = true;
    bridgeWithState.__openClawEvenG2GlassLayout = layout;
    setGlassTextCache(bridgeWithState, cacheEntries);
    return true;
  }

  const updated = await upgradeChangedGlassText(bridge, cacheEntries);
  if (updated) return true;

  const ok = await bridge.rebuildPageContainer(new RebuildPageContainer(page));
  devLog("[Even G2] voice panel rebuild result", ok, { layout });
  if (ok === true) setGlassTextCache(bridgeWithState, cacheEntries);
  return ok === true;
}
