import { describe, expect, it } from "vitest";
import {
  CANVAS_IMAGE_MAX_INLINE_BYTES,
  canvasImageDataUrlFromParams,
  canvasHideCommandResult,
  imageCanvasCommandResult,
  imageCanvasPresentationState,
  messageCanvasCommandResult,
  messageCanvasPresentationState,
  canvasMessagePresentationFromParams,
  canvasMessageTtlMsFromParams,
  canvasNodeCommandPlan,
  canvasPresentationKindFromParams,
  canvasSnapshotCommandResult,
  hasRemoteCanvasImage,
  textCanvasCommandResult,
  textCanvasGlassText,
  textCanvasPresentationState,
  textFromCanvasParams,
} from "./canvas-command";

describe("textFromCanvasParams", () => {
  it("joins title and preferred text payload", () => {
    expect(textFromCanvasParams({ title: "Deploy", body: "Ready" })).toBe("Deploy\n\nReady");
  });

  it("falls back to stripped html when no text payload is present", () => {
    expect(textFromCanvasParams({ html: "<p>Hello&nbsp;&amp;&nbsp;ready</p><script>bad()</script>" })).toBe("Hello & ready");
  });
});

describe("canvasImageDataUrlFromParams", () => {
  it("accepts data image urls and trims alt text", () => {
    expect(canvasImageDataUrlFromParams({ imageDataUrl: " data:image/png;base64,abc ", alt: " Chart " })).toEqual({
      dataUrl: "data:image/png;base64,abc",
      alt: "Chart",
    });
  });

  it("wraps long base64 payloads with the requested mime type", () => {
    const base64 = "A".repeat(68);

    expect(canvasImageDataUrlFromParams({ base64, imageMimeType: "image/jpeg" })).toEqual({
      dataUrl: `data:image/jpeg;base64,${base64}`,
      alt: "",
    });
  });

  it("rejects oversized inline image payloads before image decoding", () => {
    const dataUrl = `data:image/png;base64,${"A".repeat(CANVAS_IMAGE_MAX_INLINE_BYTES)}`;

    expect(canvasImageDataUrlFromParams({ dataUrl })).toBeNull();
    expect(canvasNodeCommandPlan("canvas.present", { dataUrl })).toEqual({
      action: "image-too-large",
      requiresBridge: false,
      maxBytes: CANVAS_IMAGE_MAX_INLINE_BYTES,
    });
  });
});

describe("hasRemoteCanvasImage", () => {
  it("only flags remote image urls", () => {
    expect(hasRemoteCanvasImage({ url: "https://example.com/image.webp?x=1" })).toBe(true);
    expect(hasRemoteCanvasImage({ image: "https://example.com/image.png" })).toBe(true);
    expect(hasRemoteCanvasImage({ dataUrl: "https://example.com/image.jpg#preview" })).toBe(true);
    expect(hasRemoteCanvasImage({ url: "https://example.com/page" })).toBe(false);
  });
});

describe("canvasPresentationKindFromParams", () => {
  it("accepts kind, mode, or presentation aliases", () => {
    expect(canvasPresentationKindFromParams({ kind: "message" })).toBe("message");
    expect(canvasPresentationKindFromParams({ mode: "notification" })).toBe("notification");
    expect(canvasPresentationKindFromParams({ presentation: "unknown" })).toBe("canvas");
  });
});

describe("canvasNodeCommandPlan", () => {
  it("plans canvas presentation variants from command params", () => {
    expect(canvasNodeCommandPlan("canvas.present", { imageDataUrl: "data:image/png;base64,abc", alt: "Chart" })).toEqual({
      action: "present-image",
      requiresBridge: true,
      imagePayload: {
        dataUrl: "data:image/png;base64,abc",
        alt: "Chart",
      },
    });
    expect(canvasNodeCommandPlan("canvas.present", { url: "https://example.com/image.png" })).toEqual({
      action: "remote-image-unsupported",
      requiresBridge: true,
    });
    expect(canvasNodeCommandPlan("canvas.present", { image: "https://example.com/image.png", title: "Chart" })).toEqual({
      action: "remote-image-unsupported",
      requiresBridge: true,
    });
    expect(canvasNodeCommandPlan("canvas.present", { kind: "message", title: "Deploy", body: "Ready" })).toEqual({
      action: "present-message",
      requiresBridge: true,
      params: { kind: "message", title: "Deploy", body: "Ready" },
      kind: "message",
      text: "Deploy\n\nReady",
    });
    expect(canvasNodeCommandPlan("canvas.present", { text: "Plain" })).toEqual({
      action: "present-text",
      requiresBridge: true,
      text: "Plain",
    });
  });

  it("plans non-present canvas commands and rejects unknown commands", () => {
    expect(canvasNodeCommandPlan("canvas.hide", {})).toEqual({
      action: "hide",
      requiresBridge: false,
    });
    expect(canvasNodeCommandPlan("canvas.snapshot", {})).toEqual({
      action: "snapshot",
      requiresBridge: false,
    });
    expect(canvasNodeCommandPlan("display.message", {})).toBeNull();
  });
});

describe("canvasMessageTtlMsFromParams", () => {
  it("uses defaults and clamps requested duration", () => {
    expect(canvasMessageTtlMsFromParams({})).toBe(8000);
    expect(canvasMessageTtlMsFromParams({ ttlMs: 50 })).toBe(1000);
    expect(canvasMessageTtlMsFromParams({ durationMs: "61000" })).toBe(60000);
    expect(canvasMessageTtlMsFromParams({ timeoutMs: 1234.9 })).toBe(1234);
  });
});

describe("canvasMessagePresentationFromParams", () => {
  it("builds message presentation copy from title and text", () => {
    expect(canvasMessagePresentationFromParams(
      { title: "Deploy", ttlMs: 3000 },
      "message",
      "Deploy\n\nReady",
    )).toEqual({
      title: "Deploy",
      body: "Ready",
      hint: "message",
      ttlMs: 3000,
    });
  });

  it("uses notification fallback title and clamps long text", () => {
    const presentation = canvasMessagePresentationFromParams(
      {},
      "notification",
      "A".repeat(390),
    );

    expect(presentation.title).toBe("Notification");
    expect(presentation.body).toHaveLength(380);
    expect(presentation.body.endsWith("...")).toBe(true);
    expect(presentation.hint).toBe("notification");
    expect(presentation.ttlMs).toBe(8000);
  });
});

describe("canvas command result helpers", () => {
  it("formats text canvas glass content", () => {
    expect(textCanvasGlassText("Hello")).toBe("main · note\n\nHello\n\npushed by gateway");
  });

  it("builds canvas presentation state for image, message, and text surfaces", () => {
    expect(imageCanvasPresentationState({ dataUrl: "data:image/png;base64,abc", alt: "" })).toEqual({
      mode: "image",
      text: "Image canvas",
      view: "canvas",
      previewText: "[image] Image canvas",
    });
    expect(messageCanvasPresentationState("notification", "Notice\n\nReady")).toEqual({
      mode: "notification",
      text: "Notice\n\nReady",
      view: "canvas",
      previewText: "Notice\n\nReady",
    });
    expect(textCanvasPresentationState("Hello")).toEqual({
      mode: "text",
      text: "main · note\n\nHello\n\npushed by gateway",
      view: "canvas",
      previewText: "main · note\n\nHello\n\npushed by gateway",
    });
  });

  it("builds present command result payloads", () => {
    const imageState = imageCanvasPresentationState({ dataUrl: "data:image/png;base64,abc", alt: "Chart" });
    expect(imageCanvasCommandResult({ state: imageState, width: 576, height: 288 })).toEqual({
      visible: true,
      mode: "image",
      width: 576,
      height: 288,
      alt: "Chart",
    });
    expect(messageCanvasCommandResult("message", {
      title: "Deploy",
      body: "Ready",
      hint: "message",
      ttlMs: 3000,
    })).toEqual({
      visible: true,
      mode: "message",
      title: "Deploy",
      text: "Ready",
      ttlMs: 3000,
    });
    expect(textCanvasCommandResult("Hello")).toEqual({
      visible: true,
      mode: "text",
      text: "Hello",
    });
  });

  it("builds hide and snapshot command results", () => {
    expect(canvasHideCommandResult()).toEqual({ visible: false });
    expect(canvasSnapshotCommandResult({
      glassView: "canvas",
      canvasMode: "message",
      canvasText: "visible text",
    })).toEqual({
      visible: true,
      mode: "message",
      view: "canvas",
      text: "visible text",
    });
    expect(canvasSnapshotCommandResult({
      glassView: "sessionHome",
      canvasMode: "text",
      canvasText: "hidden text",
    })).toEqual({
      visible: false,
      mode: "text",
      view: "sessionHome",
      text: "",
    });
  });
});
