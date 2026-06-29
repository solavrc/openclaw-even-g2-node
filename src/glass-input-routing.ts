import type { GlassInputAction } from "./glass-events";

export type GlassView =
  | "voiceSetup"
  | "sessionHome"
  | "listening"
  | "voiceDraftPending"
  | "voiceDraft"
  | "canvasTutorial"
  | "canvas"
  | "approval";

export type GlassInputRoute =
  | { action: "show-setup-required" }
  | { action: "connect" }
  | { action: "approval-allow" }
  | { action: "approval-deny" }
  | { action: "render-approval" }
  | { action: "hide-canvas" }
  | { action: "render-voice-setup" }
  | { action: "render-session-home"; status?: string; force?: boolean }
  | { action: "render-voice-draft-pending" }
  | { action: "send-voice-draft" }
  | { action: "discard-voice-draft" }
  | { action: "render-voice-draft" }
  | { action: "move-session-log"; direction: "up" | "down" }
  | { action: "request-exit" }
  | { action: "start-session-voice" }
  | { action: "skip-canvas-tutorial" }
  | { action: "cancel-voice-input" }
  | { action: "stop-voice" }
  | { action: "ignore" };

export function glassInputRoute(input: {
  action: GlassInputAction;
  connected: boolean;
  hasGatewaySetup: boolean;
  status: string;
  view: GlassView;
}): GlassInputRoute {
  if (!input.connected) {
    return input.hasGatewaySetup ? { action: "connect" } : { action: "show-setup-required" };
  }
  if (input.view === "approval") {
    if (input.action === "click") return { action: "approval-allow" };
    if (input.action === "doubleClick") return { action: "approval-deny" };
    return { action: "render-approval" };
  }
  if (input.view === "canvas") {
    return input.action === "click" ? { action: "hide-canvas" } : { action: "ignore" };
  }
  if (input.view === "voiceSetup") {
    return input.action === "click"
      ? { action: "render-session-home", status: "ready", force: true }
      : { action: "render-voice-setup" };
  }
  if (input.view === "voiceDraftPending") return { action: "render-voice-draft-pending" };
  if (input.view === "voiceDraft") {
    if (input.action === "click") return { action: "send-voice-draft" };
    if (input.action === "doubleClick") return { action: "discard-voice-draft" };
    return { action: "render-voice-draft" };
  }
  if (input.view === "sessionHome") {
    if (input.action === "up" || input.action === "down") {
      return { action: "move-session-log", direction: input.action };
    }
    if (input.action === "doubleClick") return { action: "request-exit" };
    if (input.action === "click") return { action: "start-session-voice" };
    return { action: "ignore" };
  }
  if (input.view === "canvasTutorial") {
    return input.action === "click" || input.action === "doubleClick"
      ? { action: "skip-canvas-tutorial" }
      : { action: "ignore" };
  }
  if (input.view === "listening") {
    if (input.action === "doubleClick") return { action: "cancel-voice-input" };
    if (input.action === "click") return { action: "stop-voice" };
    return { action: "ignore" };
  }
  return input.action === "click"
    ? { action: "render-session-home", status: input.status, force: true }
    : { action: "ignore" };
}
