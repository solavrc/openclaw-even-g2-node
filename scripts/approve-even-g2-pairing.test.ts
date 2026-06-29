import { describe, expect, it } from "vitest";
import {
  parseArgs,
  parseDevicePendingList,
  parseDevicePreview,
  parseNodePendingList,
  parseNodeStatusPending,
  isEvenG2Request,
} from "./approve-even-g2-pairing.ts";

describe("approve Even G2 pairing helpers", () => {
  it("defaults approve mode to watching and dry-run mode to one pass", () => {
    expect(parseArgs([])).toMatchObject({
      dryRun: false,
      watchMs: null,
      openclawArgs: [],
      openclawGlobalArgs: [],
    });
    expect(parseArgs(["--dry-run"])).toMatchObject({
      dryRun: true,
      watchMs: null,
      openclawArgs: [],
      openclawGlobalArgs: [],
    });
  });

  it("keeps Gateway CLI options for OpenClaw calls", () => {
    expect(parseArgs(["--url", "wss://gateway.example/ws", "--token", "token", "--watch-ms", "45000"])).toMatchObject({
      watchMs: 45000,
      openclawArgs: ["--url", "wss://gateway.example/ws", "--token", "token"],
      openclawGlobalArgs: [],
    });
  });

  it("keeps OpenClaw global isolation options before subcommands", () => {
    expect(parseArgs([
      "--",
      "--openclaw-container",
      "openclaw-eveng2-e2e",
      "--openclaw-profile",
      "eveng2-e2e",
      "--url",
      "wss://gateway.example/ws",
      "--token",
      "token",
    ])).toMatchObject({
      openclawArgs: ["--url", "wss://gateway.example/ws", "--token", "token"],
      openclawGlobalArgs: ["--container", "openclaw-eveng2-e2e", "--profile", "eveng2-e2e"],
    });
  });

  it("parses the latest device request from JSON preview output", () => {
    expect(parseDevicePreview(JSON.stringify({
      selected: {
        requestId: "device-request",
        displayName: "Even G2",
        platform: "even-g2",
        clientId: "node-host",
        clientMode: "ui",
        roles: ["node", "operator"],
        scopes: ["operator.read"],
      },
      approveCommand: "openclaw devices approve device-request",
    }))).toMatchObject({
      kind: "device",
      requestId: "device-request",
      displayName: "Even G2",
      platform: "even-g2",
      clientId: "node-host",
      roles: ["node", "operator"],
      scopes: ["operator.read"],
    });
  });

  it("does not treat --latest as a device request id", () => {
    expect(parseDevicePreview(JSON.stringify({
      approveCommand: "openclaw devices approve --latest",
    }))).toBeNull();

    expect(parseDevicePreview("Approve this exact request with: openclaw devices approve --latest")).toBeNull();
  });

  it("parses pending Even G2 device requests from devices list output", () => {
    expect(parseDevicePendingList(JSON.stringify([
      {
        requestId: "3b591856-9df1-4c43-be88-5359e45b1fba",
        displayName: "Even G2",
        platform: "even-g2",
        clientId: "node-host",
        clientMode: "node",
        deviceFamily: "glasses",
        roles: ["node"],
      },
    ]))).toEqual([
      expect.objectContaining({
        kind: "device",
        requestId: "3b591856-9df1-4c43-be88-5359e45b1fba",
        displayName: "Even G2",
        source: "devices-list",
      }),
    ]);
  });

  it("requires a concrete Even G2 signal beyond the generic glasses family", () => {
    expect(isEvenG2Request({
      kind: "device",
      requestId: "request-1",
      deviceFamily: "glasses",
      source: "devices-list",
    })).toBe(false);
    expect(isEvenG2Request({
      kind: "device",
      requestId: "request-node-host",
      clientId: "node-host",
      source: "devices-list",
    })).toBe(false);
    expect(isEvenG2Request({
      kind: "node",
      requestId: "request-device-only",
      clientId: "node-host",
      deviceFamily: "glasses",
      caps: ["device"],
      commands: ["device.status"],
      source: "nodes-pending",
    })).toBe(false);
    expect(isEvenG2Request({
      kind: "device",
      requestId: "request-2",
      deviceFamily: "glasses",
      displayName: "Even G2",
      source: "devices-list",
    })).toBe(true);
    expect(isEvenG2Request({
      kind: "node",
      requestId: "request-3",
      clientId: "openclaw-even-g2-node",
      source: "nodes-pending",
    })).toBe(true);
    expect(isEvenG2Request({
      kind: "node",
      requestId: "request-4",
      clientId: "node-host",
      deviceFamily: "glasses",
      commands: ["canvas.present"],
      source: "nodes-pending",
    })).toBe(true);
  });

  it("parses node pending requests with declared capabilities", () => {
    expect(parseNodePendingList(JSON.stringify([
      {
        requestId: "node-request",
        displayName: "Even G2",
        platform: "even-g2",
        deviceFamily: "glasses",
        caps: ["device", "talk", "canvas"],
        commands: ["device.status", "canvas.present"],
        requiredApproveScopes: ["operator.pairing", "operator.write"],
      },
    ]))).toEqual([
      expect.objectContaining({
        kind: "node",
        requestId: "node-request",
        caps: ["device", "talk", "canvas"],
        commands: ["device.status", "canvas.present"],
        requiredApproveScopes: ["operator.pairing", "operator.write"],
      }),
    ]);
  });

  it("parses pending node approval requests from nodes status output", () => {
    expect(parseNodeStatusPending(JSON.stringify({
      nodes: [
        {
          nodeId: "node-1",
          displayName: "Even G2",
          platform: "even-g2",
          clientId: "node-host",
          clientMode: "node",
          deviceFamily: "glasses",
          approvalState: "pending-approval",
          pendingRequestId: "node-upgrade-request",
          pendingDeclaredCaps: ["canvas", "device", "talk"],
          pendingDeclaredCommands: ["canvas.present", "device.status", "talk.ptt.once"],
        },
      ],
    }))).toEqual([
      expect.objectContaining({
        kind: "node",
        requestId: "node-upgrade-request",
        displayName: "Even G2",
        source: "nodes-status",
        caps: ["canvas", "device", "talk"],
        commands: ["canvas.present", "device.status", "talk.ptt.once"],
      }),
    ]);
  });

  it("parses a single pending node describe object", () => {
    expect(parseNodeStatusPending(JSON.stringify({
      ts: 1782549229712,
      nodeId: "node-2",
      displayName: "Even G2",
      platform: "even-g2",
      version: "0.1.15",
      clientId: "node-host",
      clientMode: "node",
      deviceFamily: "glasses",
      approvalState: "pending-approval",
      pendingRequestId: "describe-request",
      pendingDeclaredCaps: ["canvas"],
      pendingDeclaredCommands: ["canvas.snapshot"],
    }))).toEqual([
      expect.objectContaining({
        kind: "node",
        requestId: "describe-request",
        displayName: "Even G2",
        source: "nodes-status",
        caps: ["canvas"],
        commands: ["canvas.snapshot"],
      }),
    ]);
  });
});
