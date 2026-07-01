import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./main";
import {
  voiceFailureKind,
  voiceProviderNameFromError,
  voiceRecoveryAction,
  voiceRecoveryTitle,
} from "./voice-settings";
import {
  connectionGuidanceHudFrame,
  connectionGuidanceHudText,
  guidanceForConnectionState,
  setupHudFrame,
} from "./connection-guidance";
import { nodePttDurationMs, nodeVoiceCloseCommandResult } from "./voice-command";

type ReactActGlobal = typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
  __getStateSnapshot?: () => string;
  __restoreState?: (snapshot: unknown) => void;
};

(globalThis as ReactActGlobal).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

class FakeUiWebSocket extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  readonly CONNECTING = FakeUiWebSocket.CONNECTING;
  readonly OPEN = FakeUiWebSocket.OPEN;
  readonly CLOSING = FakeUiWebSocket.CLOSING;
  readonly CLOSED = FakeUiWebSocket.CLOSED;
  readyState = FakeUiWebSocket.CONNECTING;

  constructor(readonly url: string) {
    super();
  }

  send() {
    // Phone UI tests should not open real Gateway sockets.
  }

  close() {
    this.readyState = FakeUiWebSocket.CLOSED;
    this.dispatchEvent(new CloseEvent("close"));
  }
}

async function renderApp(search = "/?disableEvenBridge=1") {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  history.replaceState(null, "", search);
  await act(async () => {
    root.render(<App />);
  });
}

function storageText() {
  return localStorage.getItem("openclaw-even-g2-node-settings") || "";
}

async function rerenderWithSetupCode() {
  await act(async () => {
    root.unmount();
  });
  container.remove();
  localStorage.clear();
  await renderApp("/?disableEvenBridge=1&setupCode=wss%3A%2F%2Fgateway.example%2Fws");
}

async function rerenderWithSearch(search: string) {
  await act(async () => {
    root.unmount();
  });
  container.remove();
  localStorage.clear();
  await renderApp(search);
}

describe("phone setup surface", () => {
  beforeEach(async () => {
    vi.stubGlobal("WebSocket", FakeUiWebSocket);
    localStorage.clear();
    await renderApp();
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    vi.unstubAllGlobals();
  });

  it("keeps setup/status visible without making phone controls the primary workflow", () => {
    expect(document.querySelector("h1")?.textContent).toBe("OpenClaw Node");
    expect(document.body.textContent).toContain("Glasses node");
    expect(document.body.textContent).not.toContain("Even Hub app");
    expect([...document.querySelectorAll("button")].some((button) => button.textContent === "Disconnect")).toBe(false);
    expect(document.querySelector('[aria-label="Scan setup QR"]')?.textContent).toBe("Scan setup QR");
    expect(document.querySelector('[aria-label="Node status"]')).toBeNull();
    expect(document.querySelector('[aria-label="Node live status"]')?.textContent).toContain("Setup required");
    expect(document.querySelector('[aria-label="Node live status"]')?.textContent).toContain("Scan setup QR");
    expect(document.querySelector('[aria-label="Node live status"]')?.textContent).toContain("Set up OpenClaw Gateway");
    expect(document.querySelector('[aria-label="Node live status"]')?.textContent).toContain("Or run on OpenClaw host");
    expect(document.querySelector('[aria-label="Node live status"]')?.textContent).toContain("$ openclaw qr");
    expect(document.querySelector('[aria-label="Node live status"]')?.textContent).toContain("Hey Claw, show my Even G2 setup QR.");
    expect(document.querySelector('[aria-label="Node live status"]')?.textContent).toContain("solavrc/openclaw-even-g2-node");
    expect(document.querySelector('[aria-label="Readiness checklist"]')?.textContent).toContain("Gateway setup");
    expect(document.querySelector('[aria-label="Readiness checklist"]')?.textContent).toContain("Voice verification");
    const setupStatusText = document.querySelector('[aria-label="Node live status"]')?.textContent || "";
    expect(setupStatusText.indexOf("Ask OpenClaw with")).toBeGreaterThanOrEqual(0);
    expect(setupStatusText.indexOf("Or run on OpenClaw host")).toBeGreaterThan(setupStatusText.indexOf("Ask OpenClaw with"));
    expect(document.querySelector('[aria-label="Node live status"]')?.textContent).not.toContain("open app to use");
    expect(document.querySelector('[aria-label="Glasses content preview"]')).toBeNull();

    const details = [...document.querySelectorAll("details")];
    const summaryText = details.map((item) => item.querySelector("summary")?.textContent || "");
    expect(summaryText).toEqual(["Advanced diagnostics"]);
    expect(details.every((item) => item.open === false)).toBe(true);
    expect(document.body.textContent).toContain("Use when setup, Gateway connection, or glasses input needs troubleshooting.");
    expect(document.body.textContent).toContain("Manual fallback");
    expect(document.body.textContent).toContain("Use this only when QR scanning is unavailable.");
    expect(document.body.textContent).toContain("The normal setup path is the Scan setup QR button.");
    expect(document.body.textContent).not.toContain("1 Glasses");
    expect(document.body.textContent).not.toContain("2 Scan");
    expect(document.body.textContent).not.toContain("3 Confirm");
    expect(document.body.textContent).not.toContain("Run openclaw qr on the OpenClaw host, then scan it with this phone.");
    expect(document.body.textContent).toContain("Manual setup code");
    expect(document.body.textContent).toContain("Connect");
    expect(document.body.textContent).not.toContain("Connect to OpenClaw");
    expect(document.body.textContent).not.toContain("Reset pairing");
    expect(document.body.textContent).not.toContain("Connection");
    expect(document.body.textContent).not.toContain("Manual Gateway token");
    expect(document.body.textContent).not.toContain("Initial setup");
    expect(document.body.textContent).not.toContain("Node log");
    expect(document.body.textContent).not.toContain("Raw Even Hub events appear here");
    expect(document.body.textContent).not.toContain("576 x 288");
    expect(document.querySelector('[aria-label="Gateway setup"]')?.querySelector("textarea")).toBeNull();
  });

  it("keeps raw Even Hub logs out of the phone UI unless explicitly requested", async () => {
    expect(document.body.textContent).not.toContain("Node log");

    await rerenderWithSearch("/?disableEvenBridge=1&evenHubEventLog=1");

    expect(document.body.textContent).toContain("Node log");
    expect(document.body.textContent).toContain("Raw Even Hub events appear here when debug logging is enabled.");
  });

  it("keeps voice input out of setup controls", () => {
    const setup = document.querySelector('[aria-label="Gateway setup"]');

    expect(setup).not.toBeNull();
    expect([...document.querySelectorAll("details")].map((item) => item.querySelector("summary")?.textContent || "")).not.toContain("Voice input");
    expect(setup?.querySelector('[aria-label="Voice provider"]')).toBeNull();
    expect([...setup!.querySelectorAll("button")].some((button) => button.textContent === "Off")).toBe(false);
    expect([...setup!.querySelectorAll("button")].some((button) => button.textContent === "OpenClaw")).toBe(false);
  });

  it("shows a compact Gateway setup request next to voice mode settings", async () => {
    await rerenderWithSetupCode();

    const voiceDetails = [...document.querySelectorAll("details")]
      .find((item) => item.querySelector("summary")?.textContent === "Voice input");
    expect(voiceDetails).toBeDefined();

    await act(async () => {
      voiceDetails!.open = true;
      voiceDetails!.dispatchEvent(new Event("toggle"));
    });

    const guidance = document.querySelector('[aria-label="Voice Gateway setup guidance"]');
    expect(guidance).not.toBeNull();
    expect(guidance?.textContent).toContain("Message to OpenClaw");
    expect(guidance?.textContent).toContain("Send this message to your usual OpenClaw chat");
    expect(guidance?.textContent).toContain("Copy request");
    expect(guidance?.textContent).toContain("Set up OpenClaw Even G2 Review voice.");
    expect(guidance?.textContent).toContain("solavrc/openclaw-even-g2-node");
    expect(guidance?.textContent).toContain("Gateway voice setup guide");
    expect(guidance?.textContent).not.toContain("Provider, model, and API keys");
    expect(guidance?.textContent).not.toContain("Advanced config reference");
    expect(guidance?.textContent).not.toContain("streaming.provider");
  });

  it("switches voice modes without exposing provider credential controls", async () => {
    await rerenderWithSetupCode();

    const voiceDetails = [...document.querySelectorAll("details")]
      .find((item) => item.querySelector("summary")?.textContent === "Voice input");
    expect(voiceDetails).toBeDefined();

    await act(async () => {
      voiceDetails!.open = true;
      voiceDetails!.dispatchEvent(new Event("toggle"));
    });

    const voiceMode = document.querySelector('[aria-label="Voice mode"]');
    expect(voiceMode).not.toBeNull();
    expect(voiceMode?.textContent).toContain("Review");
    expect(voiceMode?.textContent).toContain("Send now");
    expect(voiceMode?.textContent).not.toContain("Clean");
    expect(document.body.textContent).not.toContain("Clean up transcript");
    expect(document.querySelector('[aria-label="Review provider preference"]')).not.toBeNull();
    const recordingLimit = document.querySelector('[aria-label="Voice recording limit"]') as HTMLSelectElement | null;
    expect(recordingLimit).not.toBeNull();
    expect(recordingLimit?.value).toBe("60");
    expect(recordingLimit?.textContent).toContain("10 minutes");
    expect(document.body.textContent).toContain("Choices come from OpenClaw");
    const reviewAvailability = document.querySelector('[aria-label="Review availability"]');
    expect(reviewAvailability?.textContent).toContain("Review status");
    expect(reviewAvailability?.textContent).toContain("Review waits for Gateway");
    expect(reviewAvailability?.textContent).toContain("Waiting for Gateway connection");
    expect(reviewAvailability?.textContent).toContain("After Gateway setup, verify Review with one short glasses recording.");
    expect((reviewAvailability?.querySelector("button") as HTMLButtonElement | null)?.disabled).toBe(true);

    const sendNow = [...document.querySelectorAll("button")]
      .find((button) => button.textContent?.includes("Send now")) as HTMLButtonElement | undefined;
    expect(sendNow).toBeDefined();

    await act(async () => {
      sendNow?.click();
    });

    const guidance = document.querySelector('[aria-label="Voice Gateway setup guidance"]');
    expect(guidance?.textContent).toContain("Set up OpenClaw Even G2 Send now voice.");
    expect(guidance?.textContent).toContain("Gateway voice setup guide");
    expect(guidance?.textContent).not.toContain("Provider, model, and API keys");
    expect(document.querySelector('[aria-label="Review provider preference"]')).toBeNull();
    expect(document.body.textContent).not.toContain("API key");
  });

  it("explains how to recover when a saved Review provider is missing", async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    localStorage.clear();
    localStorage.setItem("openclaw-even-g2-node-settings", JSON.stringify({
      gatewayUrl: "wss://gateway.example/ws",
      preferredReviewProvider: "custom-stt",
      voiceMode: "review",
      settingsVersion: 1,
    }));
    await renderApp("/?disableEvenBridge=1");

    const voiceDetails = [...document.querySelectorAll("details")]
      .find((item) => item.querySelector("summary")?.textContent === "Voice input");
    expect(voiceDetails).toBeDefined();

    await act(async () => {
      voiceDetails!.open = true;
      voiceDetails!.dispatchEvent(new Event("toggle"));
    });

    const providerSelect = document.querySelector('[aria-label="Review provider preference"]') as HTMLSelectElement | null;
    expect(providerSelect?.value).toBe("custom-stt");
    expect(providerSelect?.textContent).toContain("custom-stt (not available)");
    const reviewAvailability = document.querySelector('[aria-label="Review availability"]');
    expect(reviewAvailability?.textContent).toContain("Saved provider custom-stt is not in the current Gateway list.");
    expect(reviewAvailability?.textContent).toContain("Choose Gateway default");
    expect(reviewAvailability?.textContent).toContain("send the setup request to OpenClaw");
    expect(reviewAvailability?.textContent).not.toContain("API key");
  });

  it("persists the normal voice recording safety limit", async () => {
    await rerenderWithSetupCode();

    const voiceDetails = [...document.querySelectorAll("details")]
      .find((item) => item.querySelector("summary")?.textContent === "Voice input");
    expect(voiceDetails).toBeDefined();

    await act(async () => {
      voiceDetails!.open = true;
      voiceDetails!.dispatchEvent(new Event("toggle"));
    });

    const recordingLimit = document.querySelector('[aria-label="Voice recording limit"]') as HTMLSelectElement | null;
    expect(recordingLimit).not.toBeNull();

    await act(async () => {
      recordingLimit!.value = "300";
      recordingLimit!.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(storageText()).toContain('"voiceRecordingLimitSeconds":300');
    expect(document.body.textContent).toContain("Safety stop for normal glasses voice input");
  });

  it("keeps Gateway-independent voice preferences when no Gateway is configured", async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    localStorage.clear();
    localStorage.setItem("openclaw-even-g2-node-settings", JSON.stringify({
      gatewayUrl: "",
      voiceMode: "direct",
      voiceRecordingLimitSeconds: 300,
      settingsVersion: 2,
    }));

    await renderApp("/?disableEvenBridge=1");

    expect(storageText()).toContain('"gatewayUrl":""');
    expect(storageText()).toContain('"voiceMode":"direct"');
    expect(storageText()).toContain('"voiceRecordingLimitSeconds":300');
  });

  it("opens a live setup QR scanner instead of a shutter-style capture flow", async () => {
    const scanButton = document.querySelector('[aria-label="Scan setup QR"]') as HTMLButtonElement | null;
    expect(scanButton).not.toBeNull();

    await act(async () => {
      scanButton?.click();
    });

    expect(document.querySelector('[aria-label="Scan OpenClaw setup QR"]')).not.toBeNull();
    expect(document.querySelector('[aria-label="Camera preview"]')).toBeNull();
    expect(document.body.textContent).toContain("Camera preview is unavailable");
    expect(scanButton?.textContent).toBe("Scan setup QR");
  });

  it("hides setup code fallback after setup is stored", async () => {
    await rerenderWithSetupCode();

    expect(document.querySelector('[aria-label="Scan setup QR"]')).toBeNull();
    expect(document.querySelector('[aria-label="Glasses content preview"]')).toBeNull();
    expect(document.body.textContent).not.toContain("Step 4");
    expect(document.querySelector('[aria-label="Set up again"]')?.textContent).toBe("Set up again");
    expect(storageText()).toContain("wss://gateway.example/ws");
    expect(document.querySelector('[aria-label="Gateway setup"]')).toBeNull();
    expect(document.body.textContent).toContain("Connection");
    expect(document.body.textContent).toContain("App origin");
    expect(document.body.textContent).toContain(window.location.origin);
    expect(document.body.textContent).toContain("Version");
    const connectionSettings = document.querySelector('[aria-label="Connection settings"]');
    expect(connectionSettings?.textContent).toContain("Gateway");
    expect(connectionSettings?.textContent).toContain("Status");
    expect(connectionSettings?.textContent).not.toContain("App origin");
    expect(connectionSettings?.textContent).not.toContain("Version");
    expect(connectionSettings?.textContent).not.toContain("Node");
    expect(document.body.textContent).toContain("Retry now");
    expect([...document.querySelectorAll("button")].filter((button) => button.textContent === "Retry now")).toHaveLength(1);
    expect(document.body.textContent).toContain("Clears this phone's pairing before scanning a fresh setup QR.");
    expect(document.body.textContent).not.toContain("Reset pairing");
  });

  it("can open phone panels from development state URLs", async () => {
    await rerenderWithSearch("/?disableEvenBridge=1&setupCode=wss%3A%2F%2Fgateway.example%2Fws&openPanel=connection");

    const connectionDetails = [...document.querySelectorAll("details")]
      .find((item) => item.querySelector("summary")?.textContent === "Connection");
    const voiceDetails = [...document.querySelectorAll("details")]
      .find((item) => item.querySelector("summary")?.textContent === "Voice input");

    expect(connectionDetails?.open).toBe(true);
    expect(voiceDetails?.open).toBe(false);
    expect(document.body.textContent).toContain("Set up again");
    expect([...document.querySelectorAll("button")].filter((button) => button.textContent === "Retry now")).toHaveLength(1);
    expect(document.body.textContent).not.toContain("Re-scan setup QR");
    expect(document.body.textContent).not.toContain("Reset pairing");
  });

  it("lets the development voice panel close after opening it from the URL", async () => {
    await rerenderWithSearch("/?disableEvenBridge=1&setupCode=wss%3A%2F%2Fgateway.example%2Fws&openPanel=voice");

    const voiceDetails = [...document.querySelectorAll("details")]
      .find((item) => item.querySelector("summary")?.textContent === "Voice input");
    if (!voiceDetails) throw new Error("Voice input panel not found");
    expect(voiceDetails?.open).toBe(true);

    await act(async () => {
      voiceDetails.open = false;
      voiceDetails.dispatchEvent(new Event("toggle", { bubbles: true }));
    });

    expect(voiceDetails.open).toBe(false);
  });

  it("sets up again by clearing stored pairing before opening the scanner", async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    localStorage.clear();
    await renderApp("/?disableEvenBridge=1&setupCode=wss%3A%2F%2Fgateway.example%2Fws");
    localStorage.setItem("openclaw-even-g2-node-device-identity-v1", "{}");
    localStorage.setItem("openclaw-even-g2-node-device-auth-v1", "{}");

    const setupCodeInput = document.querySelector('[aria-label="Gateway setup"] input') as HTMLInputElement | null;
    expect(setupCodeInput).toBeNull();
    expect(storageText()).toContain("wss://gateway.example/ws");

    const setUpAgainButton = document.querySelector('[aria-label="Set up again"]') as HTMLButtonElement | null;
    expect(setUpAgainButton).not.toBeNull();

    await act(async () => {
      setUpAgainButton?.click();
    });

    expect(localStorage.getItem("openclaw-even-g2-node-settings")).toBeNull();
    expect(localStorage.getItem("openclaw-even-g2-node-device-identity-v1")).toBeNull();
    expect(localStorage.getItem("openclaw-even-g2-node-device-auth-v1")).toBeNull();
    expect(document.querySelector('[aria-label="Scan OpenClaw setup QR"]')).not.toBeNull();
    expect(document.body.textContent).toContain("Camera preview is unavailable");
  });

  it("clears stored pairing from the resetPairing URL flag", async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    localStorage.setItem("openclaw-even-g2-node-settings", JSON.stringify({
      gatewayUrl: "wss://gateway.example/ws",
      selectedSessionKey: "agent:main:main",
      settingsVersion: 2,
    }));
    localStorage.setItem("openclaw-even-g2-node-device-identity-v1", "{}");
    localStorage.setItem("openclaw-even-g2-node-device-auth-v1", "{}");

    await renderApp("/?disableEvenBridge=1&resetPairing=1");

    expect(localStorage.getItem("openclaw-even-g2-node-settings")).toBeNull();
    expect(localStorage.getItem("openclaw-even-g2-node-device-identity-v1")).toBeNull();
    expect(localStorage.getItem("openclaw-even-g2-node-device-auth-v1")).toBeNull();
    expect(document.querySelector('[aria-label="Node live status"]')?.textContent).toContain("OpenClaw Node");
    expect(document.querySelector('[aria-label="Node live status"]')?.textContent).toContain("Set up OpenClaw Gateway");
  });

  it("uses the phone Session card for session selection", async () => {
    await rerenderWithSetupCode();

    const selectedSession = document.querySelector('[aria-label="Selected session"]');
    expect(selectedSession).not.toBeNull();
    expect(selectedSession?.textContent).toContain("Session");
    expect(selectedSession?.textContent).toContain("agent:main:main");
    expect(selectedSession?.textContent).not.toContain("Refresh");
    expect(selectedSession?.textContent).not.toContain("New session");
    expect(selectedSession?.textContent).not.toContain("Switch on the glasses with double-tap.");
    const selector = selectedSession?.querySelector('[aria-label="Selected OpenClaw session"]') as HTMLSelectElement | null;
    expect(selector).not.toBeNull();
    expect(selector?.value).toBe("agent:main:main");
  });

  it("exposes a minimal background snapshot without one-time setup tokens", async () => {
    const setupCode = globalThis.btoa(JSON.stringify({
      url: "wss://gateway.example/ws",
      bootstrapToken: "one-time-token",
    })).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
    await rerenderWithSearch(`/?disableEvenBridge=1&setupCode=${encodeURIComponent(setupCode)}`);

    const raw = (globalThis as ReactActGlobal).__getStateSnapshot?.();
    expect(raw).toBeTruthy();
    const snapshot = JSON.parse(raw || "{}") as Record<string, { gatewayUrl?: string; voiceMode?: string }>;
    expect(snapshot["openclaw-even-g2-node"]?.gatewayUrl).toBe("wss://gateway.example/ws");
    expect(snapshot["openclaw-even-g2-node"]?.gatewayUrl).not.toContain("one-time-token");
    expect(snapshot["openclaw-even-g2-node"]?.voiceMode).toBe("review");
    expect(raw).not.toContain("bootstrapToken");
    expect(raw).not.toContain("device-auth");
    expect(raw).not.toContain("approval");
    expect(raw).not.toContain("transcript");
    expect(raw).not.toContain("voiceDraft");
  });

  it("sanitizes legacy stored setup codes before persisting or snapshotting", async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    localStorage.clear();
    const setupCode = globalThis.btoa(JSON.stringify({
      url: "wss://gateway.example/ws",
      bootstrapToken: "legacy-one-time-token",
    })).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
    localStorage.setItem("openclaw-even-g2-node-settings", JSON.stringify({
      gatewayUrl: setupCode,
      settingsVersion: 2,
    }));

    await renderApp("/?disableEvenBridge=1");

    expect(storageText()).toContain("wss://gateway.example/ws");
    expect(storageText()).not.toContain("legacy-one-time-token");
    expect(storageText()).not.toContain(setupCode);

    const raw = (globalThis as ReactActGlobal).__getStateSnapshot?.();
    expect(raw).toContain("wss://gateway.example/ws");
    expect(raw).not.toContain("legacy-one-time-token");
    expect(raw).not.toContain(setupCode);
  });

  it("restores background snapshots only to foreground-safe glasses views", async () => {
    await act(async () => {
      (globalThis as ReactActGlobal).__restoreState?.({
        "openclaw-even-g2-node": {
          settingsVersion: 2,
          gatewayUrl: "wss://gateway.example/ws",
          glassView: "voiceDraft",
          sessionCursorIndex: 2,
          sessionLogCursor: 99,
        },
      });
    });

    const raw = (globalThis as ReactActGlobal).__getStateSnapshot?.();
    expect(raw).toBeTruthy();
    const snapshot = JSON.parse(raw || "{}") as Record<string, { glassView?: string; gatewayUrl?: string }>;
    expect(snapshot["openclaw-even-g2-node"]?.gatewayUrl).toBe("wss://gateway.example/ws");
    expect(snapshot["openclaw-even-g2-node"]?.glassView).toBe("sessionHome");
  });

  it("does not let malformed background snapshots reset the voice safety limit", async () => {
    await rerenderWithSetupCode();
    const recordingLimit = document.querySelector('[aria-label="Voice recording limit"]') as HTMLSelectElement | null;
    expect(recordingLimit).not.toBeNull();

    await act(async () => {
      recordingLimit!.value = "300";
      recordingLimit!.dispatchEvent(new Event("change", { bubbles: true }));
    });

    await act(async () => {
      (globalThis as ReactActGlobal).__restoreState?.({
        "openclaw-even-g2-node": {
          settingsVersion: 2,
          voiceRecordingLimitSeconds: "not-a-number",
        },
      });
    });

    const raw = (globalThis as ReactActGlobal).__getStateSnapshot?.();
    const snapshot = JSON.parse(raw || "{}") as Record<string, { voiceRecordingLimitSeconds?: number }>;
    expect(snapshot["openclaw-even-g2-node"]?.voiceRecordingLimitSeconds).toBe(300);
  });
});

describe("connection guidance", () => {
  it("shows concrete approval commands with short intent", () => {
    const deviceGuidance = guidanceForConnectionState("error: device is not approved yet (requestId: 6fbee43c-5f38-4c2b-b7b1-13c121edf0b5)", true);
    expect(deviceGuidance?.title).toBe("Device approval required");
    expect(deviceGuidance?.body).toContain("First, trust the Even G2 device identity");
    expect(deviceGuidance?.body).toContain("second operator approval may follow");
    expect(deviceGuidance?.action).toContain("$ openclaw devices list");
    expect(deviceGuidance?.action).toContain("$ openclaw devices approve 6fbee43c-5f38-4c2b-b7b1-13c121edf0b5");
    expect(deviceGuidance?.action).toContain("Hey Claw, approve my pending Even G2 setup.");
    expect(deviceGuidance?.action).toContain("solavrc/openclaw-even-g2-node");

    const nodeGuidance = guidanceForConnectionState("error: node approval required", true);
    expect(nodeGuidance?.title).toBe("Node approval required");
    expect(nodeGuidance?.body).toContain("node command request");
    expect(nodeGuidance?.body).toContain("canvas, location, and push-to-talk");
    expect(nodeGuidance?.action).toContain("$ openclaw nodes pending");
    expect(nodeGuidance?.action).toContain("Hey Claw, approve remaining Even G2 node tools.");
    expect(nodeGuidance?.action).toContain("solavrc/openclaw-even-g2-node");

    const roleGuidance = guidanceForConnectionState("error: higher role than currently approved", true);
    expect(roleGuidance?.title).toBe("Operator approval required");
    expect(roleGuidance?.body).toContain("second device approval");
    expect(roleGuidance?.body).toContain("operator request");
    expect(roleGuidance?.body).toContain("read sessions and send voice input");
    expect(roleGuidance?.body).not.toContain("bootstrap");
    expect(roleGuidance?.action).toContain("$ openclaw devices list");
    expect(roleGuidance?.action).toContain("Hey Claw, approve remaining Even G2 operator requests.");
    expect(roleGuidance?.action).toContain("solavrc/openclaw-even-g2-node");
    expect(connectionGuidanceHudText(roleGuidance!)).toContain("Operator approval required");
    expect(connectionGuidanceHudText(roleGuidance!)).toContain("Ask OpenClaw with:");
    expect(connectionGuidanceHudText(roleGuidance!)).toContain('"Hey Claw, approve remaining Even G2 operator requests. See solavrc/openclaw-even-g2-node."');
    expect(connectionGuidanceHudText(roleGuidance!)).not.toContain("bootstrap");
    expect(connectionGuidanceHudText(roleGuidance!)).toContain("ask OpenClaw");
    expect(connectionGuidanceHudText(roleGuidance!)).not.toContain("retrying...");
    expect(connectionGuidanceHudText(roleGuidance!).length).toBeLessThan(320);

    const concreteRoleGuidance = guidanceForConnectionState("error: higher role than currently approved (requestId: 6fbee43c-5f38-4c2b-b7b1-13c121edf0b5)", true);
    expect(concreteRoleGuidance?.title).toBe("Operator approval required");
    expect(concreteRoleGuidance?.action).toContain("$ openclaw devices approve 6fbee43c-5f38-4c2b-b7b1-13c121edf0b5");
    expect(concreteRoleGuidance?.action).not.toContain("openclaw devices approve <requestId>");

    const deviceHud = connectionGuidanceHudText(deviceGuidance!);
    expect(deviceHud).toContain("Device approval required");
    expect(deviceHud).toContain("Ask OpenClaw with:");
    expect(deviceHud).toContain('"Hey Claw, approve my pending Even G2 setup. See solavrc/openclaw-even-g2-node."');
    expect(deviceHud).toContain("solavrc/openclaw-even-g2-node");
    expect(deviceHud).toContain("ask OpenClaw");
    expect(deviceHud).not.toContain("$ openclaw devices list");
    expect(deviceHud).not.toContain("6fbee43c-5f38-4c2b-b7b1-13c121edf0b5");
  });

  it("keeps HUD guidance readable on the Even G2 font", () => {
    const guidance = guidanceForConnectionState("setup required", false);
    expect(guidance?.title).toBe("OpenClaw Node");
    expect(guidance?.action).toContain("Run on OpenClaw host");
    expect(guidance?.action).toContain("$ openclaw qr");
    expect(guidance?.action).toContain("Hey Claw, show my Even G2 setup QR.");
    expect(guidance?.action).toContain("solavrc/openclaw-even-g2-node");
    expect(connectionGuidanceHudText(guidance!)).not.toContain("$ openclaw qr");
    expect(connectionGuidanceHudText(guidance!)).toContain("Ask OpenClaw with:");
    expect(connectionGuidanceHudText(guidance!)).toContain('"Hey Claw, show my Even G2 setup QR. See solavrc/openclaw-even-g2-node."');
    expect(connectionGuidanceHudText(guidance!)).not.toContain("`");
  });

  it("does not render truncated request ids as executable approval commands", () => {
    const guidance = guidanceForConnectionState(
      "error: higher role required (requestId: c8143076-345e-4083-8c86-6411123",
      true,
    );

    expect(guidance?.title).toBe("Operator approval required");
    expect(guidance?.action).toContain("Find the Even G2 request, then run `openclaw devices approve <requestId>`");
    expect(guidance?.action).not.toContain("6411123");
  });

  it("keeps setup steps in the HUD body and reserves hint for state", () => {
    expect(setupHudFrame()).toEqual({
      header: "OpenClaw Node",
      body: "Ask OpenClaw with:\n\"Hey Claw, show my Even G2 setup QR. See solavrc/openclaw-even-g2-node.\"",
      hint: "scan QR on phone",
    });

    const guidance = guidanceForConnectionState("setup required", false);
    const frame = connectionGuidanceHudFrame(guidance!);

    expect(frame.header).toBe("OpenClaw Node");
    expect(frame.body).toContain("Ask OpenClaw with:");
    expect(frame.body).toContain('"Hey Claw, show my Even G2 setup QR. See solavrc/openclaw-even-g2-node."');
    expect(frame.body).toContain("solavrc/openclaw-even-g2-node");
    expect(frame.hint).toBe("scan QR on phone");
    expect(frame.hint).not.toContain("Hey Claw");
  });

  it("keeps Gateway authentication errors visible and adds known recovery hints", () => {
    const guidance = guidanceForConnectionState(
      "error: unauthorized: too many failed authentication attempts (retry later)",
      true,
    );

    expect(guidance?.title).toBe("OpenClaw authentication paused");
    expect(guidance?.body).toBe("unauthorized: too many failed authentication attempts (retry later)");
    expect(guidance?.action).toContain("Stop app briefly to pause retries.");
    expect(guidance?.action).toContain("Use Retry now when the Gateway is ready.");
    expect(guidance?.action).toContain("$ openclaw devices list");
    expect(guidance?.action).toContain("$ openclaw nodes pending");
    expect(guidance?.action).toContain("reset pairing");

    const hud = connectionGuidanceHudText(guidance!);
    expect(hud).toContain("unauthorized: too many failed authentication attempts");
    expect(hud).toContain("OpenClaw authentication paused");
    expect(hud).not.toContain("`");
  });

  it("explains Gateway origin blocks as allowedOrigins setup", () => {
    const guidance = guidanceForConnectionState(
      "error: origin not allowed (open the Control UI from the gateway host or allow it in gateway.controlUi.allowedOrigins)",
      true,
    );

    expect(guidance?.title).toBe("Allow this app origin");
    expect(guidance?.body).toContain("Gateway rejected this WebView origin");
    expect(guidance?.action).toContain("App origin");
    expect(guidance?.action).toContain("controlUi.allowedOrigins");
    expect(guidance?.action).toContain("same secure route");
    expect(guidance?.action).toContain("Retry now");

    const hud = connectionGuidanceHudText(guidance!);
    expect(hud).toContain("Allow this app origin");
    expect(hud).toContain("gateway.controlUi.allowedOrigins");
    expect(hud).not.toContain("`");
  });

  it("separates Gateway reachability from Even Hub network permission failures", () => {
    const unreachable = guidanceForConnectionState("connection error", true);
    expect(unreachable?.title).toBe("Gateway unreachable from phone");
    expect(unreachable?.body).toContain("could not complete the Gateway WebSocket");
    expect(unreachable?.action).toContain("reachable from this phone network");
    expect(unreachable?.action).toContain("secure WSS route");

    const evenHubBlocked = guidanceForConnectionState("error: network permission denied: not in whitelist", true);
    expect(evenHubBlocked?.title).toBe("Even Hub network permission likely blocked");
    expect(evenHubBlocked?.body).toContain("blocked before the Gateway could answer");
    expect(evenHubBlocked?.action).toContain("outside Even Hub");
    expect(evenHubBlocked?.action).toContain("Advanced diagnostics");
  });
});

describe("node voice command result handling", () => {
  it("clamps node push-to-talk duration from command params and timeouts", () => {
    expect(nodePttDurationMs({ durationMs: 12_345 }, undefined)).toBe(12_345);
    expect(nodePttDurationMs({ durationMs: 250 }, undefined)).toBe(1_000);
    expect(nodePttDurationMs({ durationMs: 120_000 }, undefined)).toBe(30_000);
    expect(nodePttDurationMs(undefined, 11_000)).toBe(8_000);
    expect(nodePttDurationMs(undefined, 2_000)).toBe(1_000);
    expect(nodePttDurationMs(undefined, undefined)).toBe(8_000);
  });

  it("returns partial transcript text as a successful close result", () => {
    expect(nodeVoiceCloseCommandResult("  partial text  ")).toEqual({
      ok: true,
      payload: { text: "partial text" },
    });
  });

  it("fails close without transcript text", () => {
    expect(nodeVoiceCloseCommandResult("   ")).toEqual({
      ok: false,
      payload: {},
      error: {
        code: "VOICE_CLOSED",
        message: "Voice capture closed before a transcript was produced.",
      },
    });
  });
});

describe("voice failure recovery copy", () => {
  it("treats provider auth failures as Gateway voice setup issues without hard-coding providers", () => {
    const error = 'Realtime transcription provider "custom-stt" authentication expired';

    expect(voiceFailureKind(error)).toBe("voice-setup");
    expect(voiceProviderNameFromError(error)).toBe("custom-stt");
    expect(voiceRecoveryTitle(error, "review")).toBe("Review voice needs Gateway attention");
    expect(voiceRecoveryAction(error, "review")).toContain("configured voice provider for custom-stt");
    expect(voiceRecoveryAction(error, "review")).toContain("provider auth");
    expect(voiceRecoveryAction(error, "review")).toContain("talk.catalog");
    expect(voiceRecoveryAction(error, "review")).toContain("Set up OpenClaw Even G2 Review voice.");
    expect(voiceRecoveryAction(error, "review")).not.toContain("xAI/OpenAI");
  });

  it("uses the selected mode in the setup request after a voice failure", () => {
    const error = "provider credentials rejected";

    expect(voiceRecoveryTitle(error, "direct")).toBe("Send now voice needs Gateway attention");
    expect(voiceRecoveryAction(error, "direct")).toContain("Set up OpenClaw Even G2 Send now voice.");
  });
});
