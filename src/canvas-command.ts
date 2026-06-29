export type CanvasImagePayload = {
  dataUrl: string;
  alt: string;
};

export type CanvasPresentationKind = "canvas" | "message" | "notification";
export type CanvasMode = "text" | "image" | "message" | "notification";

export type CanvasNodeCommandPlan =
  | { action: "present-image"; requiresBridge: true; imagePayload: CanvasImagePayload }
  | { action: "image-too-large"; requiresBridge: false; maxBytes: number }
  | {
    action: "present-message";
    requiresBridge: true;
    params: Record<string, unknown>;
    kind: Extract<CanvasPresentationKind, "message" | "notification">;
    text: string;
  }
  | { action: "present-text"; requiresBridge: true; text: string }
  | { action: "remote-image-unsupported"; requiresBridge: true }
  | { action: "hide"; requiresBridge: false }
  | { action: "snapshot"; requiresBridge: false };

export type CanvasMessagePresentation = {
  title: string;
  body: string;
  hint: "message" | "notification";
  ttlMs: number;
};

export type CanvasPresentationState = {
  mode: CanvasMode;
  text: string;
  view: "canvas";
  previewText: string;
};

export const CANVAS_IMAGE_MAX_INLINE_BYTES = 1_500_000;

function stripHtml(value: string) {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'");
}

export function textFromCanvasParams(params: Record<string, unknown>) {
  const title = typeof params.title === "string" ? params.title.trim() : "";
  const textCandidates = [
    params.text,
    params.markdown,
    params.body,
    params.content,
    params.message,
    params.alt,
    params.url,
  ];
  const body = textCandidates.find((value) => typeof value === "string" && value.trim());
  const html = typeof params.html === "string" ? stripHtml(params.html).trim() : "";
  const text = typeof body === "string" ? body.trim() : html;
  return [title, text].filter(Boolean).join("\n\n").trim();
}

export function canvasImageDataUrlFromParams(params: Record<string, unknown>): CanvasImagePayload | null {
  const result = canvasImageDataUrlResultFromParams(params);
  return result === "too-large" ? null : result;
}

function canvasImageDataUrlResultFromParams(params: Record<string, unknown>): CanvasImagePayload | "too-large" | null {
  const alt = typeof params.alt === "string" ? params.alt.trim() : "";
  const mimeType = typeof params.mimeType === "string"
    ? params.mimeType.trim()
    : typeof params.imageMimeType === "string"
      ? params.imageMimeType.trim()
      : "image/png";
  const candidates = [
    params.imageDataUrl,
    params.dataUrl,
    params.image,
    params.imageData,
    params.imageBase64,
    params.base64,
    params.url,
  ];
  for (const candidate of candidates) {
    if (typeof candidate !== "string") continue;
    const value = candidate.trim();
    if (!value) continue;
    if (value.startsWith("data:image/")) {
      if (value.length > CANVAS_IMAGE_MAX_INLINE_BYTES) return "too-large";
      return { dataUrl: value, alt };
    }
    if (/^[A-Za-z0-9+/]+=*$/.test(value) && value.length > 64) {
      const dataUrl = `data:${mimeType || "image/png"};base64,${value}`;
      if (dataUrl.length > CANVAS_IMAGE_MAX_INLINE_BYTES) return "too-large";
      return { dataUrl, alt };
    }
  }
  return null;
}

export function hasRemoteCanvasImage(params: Record<string, unknown>) {
  const candidates = [
    params.imageDataUrl,
    params.dataUrl,
    params.image,
    params.imageData,
    params.imageBase64,
    params.base64,
    params.url,
  ];
  return candidates.some((candidate) => {
    if (typeof candidate !== "string") return false;
    const value = candidate.trim();
    return /^https?:\/\//i.test(value) && /\.(png|jpe?g|webp|gif|bmp)(\?|#|$)/i.test(value);
  });
}

export function canvasPresentationKindFromParams(params: Record<string, unknown>): CanvasPresentationKind {
  const raw = typeof params.kind === "string"
    ? params.kind
    : typeof params.mode === "string"
      ? params.mode
      : typeof params.presentation === "string"
        ? params.presentation
        : "";
  const value = raw.trim().toLowerCase();
  if (value === "message" || value === "notification") return value;
  return "canvas";
}

export function canvasNodeCommandPlan(command: string, params: Record<string, unknown>): CanvasNodeCommandPlan | null {
  if (command === "canvas.hide") return { action: "hide", requiresBridge: false };
  if (command === "canvas.snapshot") return { action: "snapshot", requiresBridge: false };
  if (command !== "canvas.present") return null;
  const imagePayload = canvasImageDataUrlResultFromParams(params);
  if (imagePayload === "too-large") {
    return { action: "image-too-large", requiresBridge: false, maxBytes: CANVAS_IMAGE_MAX_INLINE_BYTES };
  }
  if (imagePayload) return { action: "present-image", requiresBridge: true, imagePayload };
  if (hasRemoteCanvasImage(params)) return { action: "remote-image-unsupported", requiresBridge: true };
  const kind = canvasPresentationKindFromParams(params);
  const text = textFromCanvasParams(params) || "Canvas";
  if (kind === "message" || kind === "notification") {
    return {
      action: "present-message",
      requiresBridge: true,
      params,
      kind,
      text,
    };
  }
  return { action: "present-text", requiresBridge: true, text };
}

function numberParam(params: Record<string, unknown>, names: string[]) {
  for (const name of names) {
    const value = params[name];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

export function canvasMessageTtlMsFromParams(params: Record<string, unknown>) {
  const value = numberParam(params, ["ttlMs", "durationMs", "timeoutMs"]);
  if (value === null) return 8000;
  return Math.max(1000, Math.min(60000, Math.floor(value)));
}

function shortCanvasText(text: string, max: number) {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, Math.max(0, max - 3))}...` : clean;
}

export function canvasMessagePresentationFromParams(
  params: Record<string, unknown>,
  kind: Extract<CanvasPresentationKind, "message" | "notification">,
  text: string,
): CanvasMessagePresentation {
  const title = typeof params.title === "string" && params.title.trim()
    ? params.title.trim()
    : kind === "notification"
      ? "Notification"
      : "Message";
  return {
    title: shortCanvasText(title, 48),
    body: shortCanvasText(text.replace(title, "").trim() || text, 380),
    hint: kind,
    ttlMs: canvasMessageTtlMsFromParams(params),
  };
}

export function textCanvasGlassText(text: string) {
  return `main · note\n\n${text}\n\npushed by gateway`;
}

export function imageCanvasPresentationState(payload: CanvasImagePayload): CanvasPresentationState {
  const alt = payload.alt || "Image canvas";
  return {
    mode: "image",
    text: alt,
    view: "canvas",
    previewText: `[image] ${alt}`,
  };
}

export function textCanvasPresentationState(text: string): CanvasPresentationState {
  const glassText = textCanvasGlassText(text);
  return {
    mode: "text",
    text: glassText,
    view: "canvas",
    previewText: glassText,
  };
}

export function messageCanvasPresentationState(
  kind: Extract<CanvasPresentationKind, "message" | "notification">,
  glassText: string,
): CanvasPresentationState {
  return {
    mode: kind,
    text: glassText,
    view: "canvas",
    previewText: glassText,
  };
}

export function imageCanvasCommandResult(input: {
  state: CanvasPresentationState;
  width: number;
  height: number;
}) {
  return {
    visible: true,
    mode: "image" as const,
    width: input.width,
    height: input.height,
    alt: input.state.text,
  };
}

export function messageCanvasCommandResult(
  kind: Extract<CanvasPresentationKind, "message" | "notification">,
  presentation: CanvasMessagePresentation,
) {
  return {
    visible: true,
    mode: kind,
    title: presentation.title,
    text: presentation.body,
    ttlMs: presentation.ttlMs,
  };
}

export function textCanvasCommandResult(text: string) {
  return { visible: true, mode: "text" as const, text };
}

export function canvasHideCommandResult() {
  return { visible: false };
}

export function canvasSnapshotCommandResult(input: {
  glassView: string;
  canvasText: string;
  canvasMode: CanvasMode;
}) {
  const visible = input.glassView === "canvas" && Boolean(input.canvasText);
  return {
    visible,
    mode: input.canvasMode,
    view: input.glassView,
    text: visible ? input.canvasText : "",
  };
}
