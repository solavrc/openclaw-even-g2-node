import { describe, expect, it } from "vitest";
import { glassInputRoute } from "./glass-input-routing";
import type { GlassInputAction } from "./glass-events";
import type { GlassView } from "./glass-input-routing";

const baseInput = {
  action: "click" as GlassInputAction,
  connected: true,
  hasGatewaySetup: true,
  status: "ready",
  view: "sessionHome" as GlassView,
};

describe("glassInputRoute", () => {
  it("routes disconnected input to setup or connect", () => {
    expect(glassInputRoute({ ...baseInput, connected: false, hasGatewaySetup: false })).toEqual({
      action: "show-setup-required",
    });
    expect(glassInputRoute({ ...baseInput, connected: false, hasGatewaySetup: true })).toEqual({
      action: "connect",
    });
  });

  it("routes approval actions", () => {
    expect(glassInputRoute({ ...baseInput, view: "approval", action: "click" })).toEqual({ action: "approval-allow" });
    expect(glassInputRoute({ ...baseInput, view: "approval", action: "doubleClick" })).toEqual({ action: "approval-deny" });
    expect(glassInputRoute({ ...baseInput, view: "approval", action: "up" })).toEqual({ action: "render-approval" });
  });

  it("routes canvas and setup views", () => {
    expect(glassInputRoute({ ...baseInput, view: "canvas", action: "click" })).toEqual({ action: "hide-canvas" });
    expect(glassInputRoute({ ...baseInput, view: "canvas", action: "up" })).toEqual({ action: "ignore" });
    expect(glassInputRoute({ ...baseInput, view: "voiceSetup", action: "click" })).toEqual({
      action: "render-session-home",
      status: "ready",
      force: true,
    });
    expect(glassInputRoute({ ...baseInput, view: "voiceSetup", action: "up" })).toEqual({ action: "render-voice-setup" });
  });

  it("routes voice draft views", () => {
    expect(glassInputRoute({ ...baseInput, view: "voiceDraftPending", action: "down" })).toEqual({
      action: "render-voice-draft-pending",
    });
    expect(glassInputRoute({ ...baseInput, view: "voiceDraft", action: "click" })).toEqual({ action: "send-voice-draft" });
    expect(glassInputRoute({ ...baseInput, view: "voiceDraft", action: "doubleClick" })).toEqual({ action: "discard-voice-draft" });
    expect(glassInputRoute({ ...baseInput, view: "voiceDraft", action: "down" })).toEqual({ action: "render-voice-draft" });
  });

  it("routes session home navigation and actions", () => {
    expect(glassInputRoute({ ...baseInput, view: "sessionHome", action: "up" })).toEqual({
      action: "move-session-log",
      direction: "up",
    });
    expect(glassInputRoute({ ...baseInput, view: "sessionHome", action: "down" })).toEqual({
      action: "move-session-log",
      direction: "down",
    });
    expect(glassInputRoute({ ...baseInput, view: "sessionHome", action: "doubleClick" })).toEqual({ action: "request-exit" });
    expect(glassInputRoute({ ...baseInput, view: "sessionHome", action: "click" })).toEqual({ action: "start-session-voice" });
  });

  it("routes tutorial and listening views", () => {
    expect(glassInputRoute({ ...baseInput, view: "canvasTutorial", action: "click" })).toEqual({ action: "skip-canvas-tutorial" });
    expect(glassInputRoute({ ...baseInput, view: "canvasTutorial", action: "doubleClick" })).toEqual({ action: "skip-canvas-tutorial" });
    expect(glassInputRoute({ ...baseInput, view: "canvasTutorial", action: "up" })).toEqual({ action: "ignore" });
    expect(glassInputRoute({ ...baseInput, view: "listening", action: "doubleClick" })).toEqual({ action: "cancel-voice-input" });
    expect(glassInputRoute({ ...baseInput, view: "listening", action: "click" })).toEqual({ action: "stop-voice" });
    expect(glassInputRoute({ ...baseInput, view: "listening", action: "up" })).toEqual({ action: "ignore" });
  });
});
