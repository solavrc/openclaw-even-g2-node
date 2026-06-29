import { act } from "react";
import type { ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConnectionSettingsPanel, DiagnosticsPanel, NodeLiveStatusPanel, diagnosticRows } from "./phone-status-view";

type ReactActGlobal = typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

(globalThis as ReactActGlobal).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

async function render(element: ReactNode) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(element);
  });
}

beforeEach(() => {
  document.body.innerHTML = "";
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
});

describe("NodeLiveStatusPanel", () => {
  it("renders live facts, guidance, recovery, and invokes the live action", async () => {
    const onLiveAction = vi.fn();
    await render(
      <NodeLiveStatusPanel
        appOrigin="http://localhost:5173"
        connectionGuidance={{
          title: "Set up OpenClaw Gateway",
          body: "Scan the setup QR.",
          action: [
            "Run on OpenClaw host:",
            "`$ openclaw qr`",
            "Or ask OpenClaw:",
            "\"Hey Claw, show my Even G2 setup QR.\"",
          ].join("\n"),
        }}
        connectionState="Disconnected"
        liveActionLabel="Scan setup QR"
        liveFacts={["Gateway offline", "scan setup QR"]}
        liveStateLabel="Setup required"
        originNotAllowed
        setupScanStatus="Setup code missing."
        status="setup required"
        voiceFailureActionText="Check Gateway voice setup."
        voiceFailureErrorText="provider failed"
        voiceFailureTitleText="Voice setup needed"
        voiceStatusLabel="voice setup after pairing"
        onLiveAction={onLiveAction}
      />,
    );

    const panel = document.querySelector('[aria-label="Node live status"]');
    expect(panel?.textContent).toContain("Setup required");
    expect(panel?.textContent).toContain("Gateway offline");
    expect(panel?.textContent).toContain("Set up OpenClaw Gateway");
    expect(panel?.textContent).toContain("Hey Claw, show my Even G2 setup QR.");
    expect(panel?.textContent).toContain("Allow this App origin in OpenClaw.");
    expect(panel?.textContent).toContain("provider failed");

    await act(async () => {
      (panel?.querySelector("button") as HTMLButtonElement).click();
    });

    expect(onLiveAction).toHaveBeenCalledOnce();
  });
});

describe("ConnectionSettingsPanel", () => {
  it("renders connection status and setup reset action", async () => {
    const onSetUpAgain = vi.fn();
    await render(
      <ConnectionSettingsPanel
        defaultOpen
        connectionState="Disconnected"
        retryStatusLabel="Auto retry in ~5s"
        status="needs attention"
        storedGatewayLabel="wss://gateway.example/ws"
        onSetUpAgain={onSetUpAgain}
      />,
    );

    const details = document.querySelector("details") as HTMLDetailsElement;
    expect(details.open).toBe(true);
    expect(document.body.textContent).toContain("wss://gateway.example/ws");
    expect(document.body.textContent).toContain("Auto retry in ~5s");

    await act(async () => {
      (document.querySelector("button") as HTMLButtonElement).click();
    });

    expect(onSetUpAgain).toHaveBeenCalledOnce();
  });
});

describe("DiagnosticsPanel", () => {
  it("builds diagnostics rows from setup state", () => {
    expect(diagnosticRows({
      activeSessionLabel: "Main",
      appOrigin: "",
      appVersion: "0.1.15",
      canvasTextLabel: "",
      connectionState: "Disconnected",
      deviceId: "",
      glassView: "sessionHome",
      hasGatewaySetup: false,
      nodeApprovalState: "",
      nodeDetail: "",
      nodeId: "",
      nodePendingRequestId: "",
      nodeStatusLabel: "Not paired",
      sessionKey: "",
      voiceModeLabelText: "Review",
    })).toEqual([
      { label: "Gateway", value: "Disconnected" },
      { label: "Node", value: "Not paired" },
      { label: "App origin", value: "Unavailable" },
      { label: "Version", value: "0.1.15" },
    ]);

    expect(diagnosticRows({
      activeSessionLabel: "Main",
      appOrigin: "http://localhost:5173",
      appVersion: "0.1.15",
      canvasTextLabel: "canvas",
      connectionState: "Connected",
      deviceId: "device-1",
      glassView: "sessionHome",
      hasGatewaySetup: true,
      nodeApprovalState: "approved",
      nodeDetail: "Session: Main",
      nodeId: "node-1",
      nodePendingRequestId: "request-1",
      nodeStatusLabel: "Paired",
      sessionKey: "",
      voiceModeLabelText: "Review",
    })).toContainEqual({ label: "Session key", value: "Resolving" });
    expect(diagnosticRows({
      activeSessionLabel: "Main",
      appOrigin: "http://localhost:5173",
      appVersion: "0.1.15",
      canvasTextLabel: "canvas",
      connectionState: "Connected",
      deviceId: "device-1",
      glassView: "sessionHome",
      hasGatewaySetup: true,
      nodeApprovalState: "approved",
      nodeDetail: "Session: Main",
      nodeId: "node-1",
      nodePendingRequestId: "request-1",
      nodeStatusLabel: "Paired",
      sessionKey: "",
      voiceModeLabelText: "Review",
    })).toEqual(expect.arrayContaining([
      { label: "Device ID", value: "device-1" },
      { label: "Node ID", value: "node-1" },
      { label: "Node approval", value: "approved" },
      { label: "Node request", value: "request-1" },
    ]));
  });

  it("renders diagnostics and event log rows", async () => {
    await render(
      <DiagnosticsPanel
        defaultOpen
        activeSessionLabel="Main"
        appOrigin="http://localhost:5173"
        appVersion="0.1.15"
        canvasTextLabel="hello canvas"
        connectionState="Connected"
        deviceId="device-1"
        evenHubEvents={[{
          id: 1,
          at: "2026-06-28T00:00:00.000Z",
          deltaMs: null,
          action: "audio",
          payload: { sample: true },
        }]}
        glassView="sessionHome"
        hasGatewaySetup
        nodeApprovalState="approved"
        nodeDetail="Session: Main"
        nodeId="node-1"
        nodePendingRequestId="request-1"
        nodeStatusLabel="Paired · G2 bridge live"
        sessionKey="agent:main:main"
        sessionTranscriptError=""
        showEventDiagnostics
        voiceModeLabelText="Review"
      />,
    );

    const diagnostics = document.querySelector('[aria-label="Connection diagnostics"]');
    expect((document.querySelector("details") as HTMLDetailsElement).open).toBe(true);
    expect(diagnostics?.textContent).toContain("Connected");
    expect(diagnostics?.textContent).toContain("0.1.15");
    expect(diagnostics?.textContent).toContain("hello canvas");
    expect(document.querySelector('[aria-label="Node event log"]')?.textContent).toContain("audio");
    expect(document.querySelector('[aria-label="Node event log"]')?.textContent).toContain('"sample":true');
  });
});
