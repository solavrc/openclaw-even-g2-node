import { describe, expect, it } from "vitest";
import {
  CANVAS_TUTORIAL_REQUEST,
  canvasImageFitRect,
  canvasImageTilePlans,
  canvasTutorialFrameDelayMs,
  canvasTutorialImageDataUrl,
  heyClawAskFromGuidance,
  heyClawAskFromText,
  nextCanvasTutorialStep,
  openClawAskFallbackFrame,
  openClawAskPreviewText,
  shouldRenderCanvasTutorialFrame,
} from "./canvas-renderer";

describe("canvas renderer helpers", () => {
  it("extracts Hey Claw requests from quoted guidance text", () => {
    expect(heyClawAskFromText('Ask OpenClaw with "Hey Claw, show setup QR."')).toBe("Hey Claw, show setup QR.");
    expect(heyClawAskFromText("No request here")).toBe("");
  });

  it("extracts Hey Claw requests from structured guidance", () => {
    expect(heyClawAskFromGuidance({
      title: "Setup",
      body: "Scan setup QR",
      action: 'Ask OpenClaw with "Hey Claw, show my Even G2 setup QR."',
    })).toBe("Hey Claw, show my Even G2 setup QR.");
  });

  it("formats OpenClaw ask canvas preview and fallback frames", () => {
    const options = {
      ask: "Hey Claw, show my Even G2 setup QR.",
      header: "OpenClaw Node",
      hint: "scan QR on phone",
    };

    expect(openClawAskPreviewText(options)).toBe([
      "OpenClaw Node",
      "Ask OpenClaw with:",
      "\"Hey Claw, show my Even G2 setup QR.\"",
      "scan QR on phone",
    ].join("\n"));
    expect(openClawAskFallbackFrame(options)).toEqual({
      header: "OpenClaw Node",
      body: "Ask OpenClaw with:\n\"Hey Claw, show my Even G2 setup QR.\"",
      hint: "scan QR on phone",
    });
    expect(openClawAskFallbackFrame({
      ask: "Hey Claw, approve setup.",
      header: "Approval",
    }).hint).toBe("ask OpenClaw");
  });

  it("returns inline SVG data URLs for tutorial images", () => {
    expect(canvasTutorialImageDataUrl(0)).toMatch(/^data:image\/svg\+xml;base64,/);
    expect(canvasTutorialImageDataUrl(1)).toMatch(/^data:image\/svg\+xml;base64,/);
  });

  it("keeps tutorial sequencing state pure", () => {
    expect(CANVAS_TUTORIAL_REQUEST).toContain("Hey Claw");
    expect(canvasTutorialFrameDelayMs(0)).toBe(1200);
    expect(canvasTutorialFrameDelayMs(2)).toBe(0);
    expect(nextCanvasTutorialStep(0)).toBe(1);
    expect(nextCanvasTutorialStep(2)).toBe(2);
    expect(shouldRenderCanvasTutorialFrame({
      generation: 2,
      currentGeneration: 2,
      completed: false,
    })).toBe(true);
    expect(shouldRenderCanvasTutorialFrame({
      generation: 1,
      currentGeneration: 2,
      completed: false,
    })).toBe(false);
  });

  it("fits image canvas payloads inside the Even G2 canvas", () => {
    expect(canvasImageFitRect(1152, 288)).toEqual({
      x: 0,
      y: 72,
      width: 576,
      height: 144,
    });
    expect(canvasImageFitRect(288, 576)).toEqual({
      x: 216,
      y: 0,
      width: 144,
      height: 288,
    });
    expect(() => canvasImageFitRect(0, 288)).toThrow("Canvas image has no dimensions.");
  });

  it("splits image canvas payloads into the Even G2 2x2 tile layout", () => {
    expect(canvasImageTilePlans()).toEqual([
      { id: 10, name: "canvas-image-0", x: 0, y: 0, sourceX: 0, sourceY: 0, width: 288, height: 144 },
      { id: 11, name: "canvas-image-1", x: 288, y: 0, sourceX: 288, sourceY: 0, width: 288, height: 144 },
      { id: 12, name: "canvas-image-2", x: 0, y: 144, sourceX: 0, sourceY: 144, width: 288, height: 144 },
      { id: 13, name: "canvas-image-3", x: 288, y: 144, sourceX: 288, sourceY: 144, width: 288, height: 144 },
    ]);
  });
});
