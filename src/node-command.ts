import type { DeviceInfo, DeviceStatus } from "@evenrealities/even_hub_sdk";
import { serializableDeviceInfo, serializableDeviceStatus } from "./even-device-status";

export const OPENCLAW_NODE_COMMANDS = [
  "device.status",
  "device.info",
  "device.health",
  "device.permissions",
  "talk.ptt.once",
  "canvas.present",
  "canvas.hide",
  "canvas.snapshot",
] as const;

export const CANVAS_COMMANDS = ["canvas.present", "canvas.hide", "canvas.snapshot"] as const;
export const CANVAS_PRESENT_KINDS = ["canvas", "message", "notification"] as const;
export const CANVAS_TEXT_PAYLOAD_FIELDS = ["title", "text", "markdown", "body", "content", "message", "html"] as const;
export const CANVAS_IMAGE_PAYLOAD_FIELDS = ["imageDataUrl", "dataUrl", "image", "imageData", "imageBase64", "base64"] as const;
export const CANVAS_IMAGE_MIME_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export const BRIDGE_REQUIRED_COMMANDS = ["talk.ptt.once", "canvas.present"] as const;
export type NodeCommandFamily = "device" | "canvas" | "talk" | "unsupported";

export type NodeCommandError = {
  code: string;
  message: string;
};

export function nodeCommandIdFromMessage(message: { id?: unknown }) {
  return typeof message.id === "string" ? message.id : "";
}

export function nodeCommandNameFromMessage(message: { command?: unknown }) {
  return typeof message.command === "string" ? message.command : "";
}

export function nodeCommandFamily(command: string): NodeCommandFamily {
  if (command === "device.status" || command === "device.info" || command === "device.health" || command === "device.permissions") {
    return "device";
  }
  if (command === "canvas.present" || command === "canvas.hide" || command === "canvas.snapshot") return "canvas";
  if (command === "talk.ptt.once") return "talk";
  return "unsupported";
}

export function evenG2BridgeUnavailableError(): NodeCommandError {
  return {
    code: "EVEN_G2_BRIDGE_UNAVAILABLE",
    message: "The Even G2 live bridge is not connected. Reopen the OpenClaw Node app on the glasses.",
  };
}

export function glassRenderFailedError(surface: "canvas" | "image canvas" | "message canvas"): NodeCommandError {
  return {
    code: "GLASS_RENDER_FAILED",
    message: `Even Hub did not accept the ${surface} update for the glasses.`,
  };
}

export function canvasImageUrlUnsupportedError(): NodeCommandError {
  return {
    code: "CANVAS_IMAGE_URL_UNSUPPORTED",
    message: "Image canvas currently requires data:image/... or base64 image data. Fetch remote images in Gateway and send inline image data.",
  };
}

export function canvasImageFailedError(message: string): NodeCommandError {
  return {
    code: "CANVAS_IMAGE_FAILED",
    message,
  };
}

export function unsupportedNodeCommandError(command: string): NodeCommandError {
  return {
    code: "COMMAND_NOT_SUPPORTED",
    message: `Unsupported command: ${command}`,
  };
}

export function voiceBusyError(): NodeCommandError {
  return {
    code: "VOICE_BUSY",
    message: "A voice capture is already active.",
  };
}

type DeviceStatusResultOptions = {
  connected: boolean;
  bridgeLive: boolean;
  keepAlive: unknown;
  activeSessionKey: string;
  view: string;
  listening: boolean;
  deviceStatus: DeviceStatus | null;
};

export function deviceStatusCommandResult(options: DeviceStatusResultOptions) {
  const deviceStatus = serializableDeviceStatus(options.deviceStatus);
  return {
    connected: options.connected,
    bridgeLive: options.bridgeLive,
    keepAlive: options.keepAlive,
    displayName: "Even G2",
    platform: "even-g2",
    deviceFamily: "glasses",
    modelIdentifier: "Even G2",
    activeSessionKey: options.activeSessionKey,
    view: options.view,
    listening: options.listening,
    device: deviceStatus,
    battery: deviceStatus?.battery ?? null,
    wearing: deviceStatus?.isWearing ?? null,
    inCase: deviceStatus?.isInCase ?? null,
  };
}

type DeviceInfoResultOptions = {
  version: string;
  deviceInfo: DeviceInfo | null;
  canvasWidth: number;
  canvasHeight: number;
};

export function deviceInfoCommandResult(options: DeviceInfoResultOptions) {
  return {
    displayName: "Even G2",
    platform: "even-g2",
    deviceFamily: "glasses",
    modelIdentifier: "Even G2",
    version: options.version,
    capabilities: ["device", "talk", "canvas"],
    commands: OPENCLAW_NODE_COMMANDS,
    device: serializableDeviceInfo(options.deviceInfo),
    canvas: {
      width: options.canvasWidth,
      height: options.canvasHeight,
      commands: CANVAS_COMMANDS,
      presentKinds: CANVAS_PRESENT_KINDS,
      textPayloadFields: CANVAS_TEXT_PAYLOAD_FIELDS,
      imagePayloadFields: CANVAS_IMAGE_PAYLOAD_FIELDS,
      imageMimeTypes: CANVAS_IMAGE_MIME_TYPES,
      remoteImageUrls: false,
    },
  };
}

type DeviceHealthResultOptions = {
  bridgeLive: boolean;
  keepAlive: unknown;
  gatewayConnected: boolean;
  activeSessionKey: string;
};

export function deviceHealthCommandResult(options: DeviceHealthResultOptions) {
  return {
    ok: true,
    bridgeLive: options.bridgeLive,
    keepAlive: options.keepAlive,
    gatewayConnected: options.gatewayConnected,
    microphone: options.bridgeLive ? "on-demand" : "bridge-required",
    activeSessionKey: options.activeSessionKey,
  };
}

type DevicePermissionsResultOptions = {
  bridgeLive: boolean;
  keepAlive: unknown;
  gatewayConnected: boolean;
};

export function devicePermissionsCommandResult(options: DevicePermissionsResultOptions) {
  return {
    bridgeLive: options.bridgeLive,
    keepAlive: options.keepAlive,
    gatewayConnected: options.gatewayConnected,
    permissions: {
      network: "configured-by-even-hub",
      microphone: options.bridgeLive ? "on-demand" : "bridge-required",
      camera: options.bridgeLive ? "on-demand" : "bridge-required",
    },
    bridgeRequiredCommands: BRIDGE_REQUIRED_COMMANDS,
  };
}

type DeviceNodeCommandPayloadOptions =
  & DeviceStatusResultOptions
  & DeviceInfoResultOptions
  & {
    gatewayConnected: boolean;
  };

export function deviceNodeCommandPayload(command: string, options: DeviceNodeCommandPayloadOptions) {
  if (command === "device.status") return deviceStatusCommandResult(options);
  if (command === "device.info") return deviceInfoCommandResult(options);
  if (command === "device.health") {
    return deviceHealthCommandResult({
      bridgeLive: options.bridgeLive,
      keepAlive: options.keepAlive,
      gatewayConnected: options.gatewayConnected,
      activeSessionKey: options.activeSessionKey,
    });
  }
  if (command === "device.permissions") {
    return devicePermissionsCommandResult({
      bridgeLive: options.bridgeLive,
      keepAlive: options.keepAlive,
      gatewayConnected: options.gatewayConnected,
    });
  }
  return null;
}
