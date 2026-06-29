import { DeviceConnectType, DeviceInfo, DeviceModel, DeviceStatus } from "@evenrealities/even_hub_sdk";
import { describe, expect, it } from "vitest";
import { CANVAS_IMAGE_MAX_INLINE_BYTES } from "./canvas-command";
import {
  CANVAS_COMMANDS,
  OPENCLAW_NODE_COMMANDS,
  canvasImageFailedError,
  canvasImageTooLargeError,
  canvasImageUrlUnsupportedError,
  deviceHealthCommandResult,
  deviceInfoCommandResult,
  deviceNodeCommandPayload,
  devicePermissionsCommandResult,
  deviceStatusCommandResult,
  evenG2BridgeUnavailableError,
  glassRenderFailedError,
  nodeCommandFamily,
  nodeCommandIdFromMessage,
  nodeCommandNameFromMessage,
  unsupportedNodeCommandError,
  voiceBusyError,
} from "./node-command";

function connectedStatus() {
  return new DeviceStatus({
    sn: "G2-42",
    connectType: DeviceConnectType.Connected,
    batteryLevel: 77,
    isCharging: false,
    isWearing: true,
    isInCase: false,
  });
}

describe("deviceStatusCommandResult", () => {
  it("combines gateway state with serialized Even Hub device status", () => {
    expect(deviceStatusCommandResult({
      connected: true,
      bridgeLive: true,
      keepAlive: { active: true },
      activeSessionKey: "agent:main:main",
      view: "sessionHome",
      listening: false,
      deviceStatus: connectedStatus(),
    })).toMatchObject({
      connected: true,
      bridgeLive: true,
      displayName: "Even G2",
      platform: "even-g2",
      activeSessionKey: "agent:main:main",
      device: {
        sn: "G2-42",
        batteryLevel: 77,
      },
      battery: {
        level: 0.77,
      },
      wearing: true,
      inCase: false,
    });
  });
});

describe("deviceInfoCommandResult", () => {
  it("advertises node commands and canvas payload policy", () => {
    const info = new DeviceInfo({
      model: DeviceModel.G2,
      sn: "G2-42",
      status: connectedStatus(),
    });

    expect(deviceInfoCommandResult({
      version: "0.1.15",
      deviceInfo: info,
      canvasWidth: 576,
      canvasHeight: 288,
    })).toMatchObject({
      version: "0.1.15",
      capabilities: ["device", "talk", "canvas"],
      commands: OPENCLAW_NODE_COMMANDS,
      canvas: {
        width: 576,
        height: 288,
        commands: CANVAS_COMMANDS,
        presentKinds: ["canvas", "message", "notification"],
        maxInlineImageBytes: CANVAS_IMAGE_MAX_INLINE_BYTES,
        remoteImageUrls: false,
      },
      device: {
        model: DeviceModel.G2,
        sn: "G2-42",
      },
    });
  });
});

describe("deviceHealthCommandResult", () => {
  it("reports bridge-dependent microphone health", () => {
    expect(deviceHealthCommandResult({
      bridgeLive: false,
      keepAlive: { active: false },
      gatewayConnected: true,
      activeSessionKey: "agent:main:main",
    })).toMatchObject({
      ok: true,
      microphone: "bridge-required",
      gatewayConnected: true,
    });
  });
});

describe("devicePermissionsCommandResult", () => {
  it("marks microphone and camera as on-demand when bridge is live", () => {
    expect(devicePermissionsCommandResult({
      bridgeLive: true,
      keepAlive: { active: true },
      gatewayConnected: true,
    })).toMatchObject({
      permissions: {
        network: "configured-by-even-hub",
        microphone: "on-demand",
        camera: "on-demand",
      },
      bridgeRequiredCommands: ["talk.ptt.once", "canvas.present"],
    });
  });
});

describe("deviceNodeCommandPayload", () => {
  it("selects device command payloads by command name", () => {
    const shared = {
      connected: true,
      bridgeLive: true,
      keepAlive: { active: true },
      activeSessionKey: "agent:main:main",
      view: "sessionHome",
      listening: false,
      deviceStatus: connectedStatus(),
      version: "0.1.15",
      deviceInfo: null,
      canvasWidth: 576,
      canvasHeight: 288,
      gatewayConnected: true,
    };

    expect(deviceNodeCommandPayload("device.status", shared)).toMatchObject({
      displayName: "Even G2",
      activeSessionKey: "agent:main:main",
    });
    expect(deviceNodeCommandPayload("device.info", shared)).toMatchObject({
      version: "0.1.15",
      canvas: { width: 576, height: 288 },
    });
    expect(deviceNodeCommandPayload("device.health", shared)).toMatchObject({
      ok: true,
      gatewayConnected: true,
    });
    expect(deviceNodeCommandPayload("device.permissions", shared)).toMatchObject({
      permissions: { microphone: "on-demand" },
    });
    expect(deviceNodeCommandPayload("canvas.present", shared)).toBeNull();
  });
});

describe("node command message helpers", () => {
  it("normalizes ids and command names from gateway messages", () => {
    expect(nodeCommandIdFromMessage({ id: "cmd-1" })).toBe("cmd-1");
    expect(nodeCommandIdFromMessage({ id: 42 })).toBe("");
    expect(nodeCommandNameFromMessage({ command: "device.status" })).toBe("device.status");
    expect(nodeCommandNameFromMessage({ command: null })).toBe("");
  });

  it("classifies node commands by handling surface", () => {
    expect(nodeCommandFamily("device.status")).toBe("device");
    expect(nodeCommandFamily("device.permissions")).toBe("device");
    expect(nodeCommandFamily("canvas.present")).toBe("canvas");
    expect(nodeCommandFamily("talk.ptt.once")).toBe("talk");
    expect(nodeCommandFamily("display.message")).toBe("unsupported");
  });

  it("formats shared node command errors", () => {
    expect(evenG2BridgeUnavailableError()).toMatchObject({
      code: "EVEN_G2_BRIDGE_UNAVAILABLE",
    });
    expect(glassRenderFailedError("message canvas")).toEqual({
      code: "GLASS_RENDER_FAILED",
      message: "Even Hub did not accept the message canvas update for the glasses.",
    });
    expect(canvasImageUrlUnsupportedError()).toMatchObject({
      code: "CANVAS_IMAGE_URL_UNSUPPORTED",
    });
    expect(canvasImageTooLargeError()).toEqual({
      code: "CANVAS_IMAGE_TOO_LARGE",
      message: `Image canvas inline payload is too large. Send data:image/... or base64 image data no larger than ${CANVAS_IMAGE_MAX_INLINE_BYTES} bytes.`,
    });
    expect(canvasImageFailedError("bad image")).toEqual({
      code: "CANVAS_IMAGE_FAILED",
      message: "bad image",
    });
    expect(unsupportedNodeCommandError("display.message")).toEqual({
      code: "COMMAND_NOT_SUPPORTED",
      message: "Unsupported command: display.message",
    });
    expect(voiceBusyError()).toEqual({
      code: "VOICE_BUSY",
      message: "A voice capture is already active.",
    });
  });
});
