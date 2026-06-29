import { describe, expect, it } from "vitest";
import {
  approvalResolveAckAccepted,
  gatewayApprovalUpdate,
  gatewayErrorStatusFromMessage,
  nodeApprovalReadySnapshot,
  nodeApprovalRequiredFromSnapshot,
  nodeApprovalStateApproved,
  nodeApprovalStateExplicitlyReady,
  parseGatewayMessageData,
  parseVoiceGatewayMessageData,
  pendingApprovalResolved,
  runtimeStatusSessionUpdate,
  sessionConfigOrSwitchUpdate,
  sessionKeyFromConfigOrSwitchMessage,
  sessionKeyFromRuntimeStatusMessage,
  sessionSendAckMatchesCurrentSession,
} from "./gateway-messages";

describe("gateway message parsing", () => {
  it("parses gateway JSON message data", () => {
    expect(parseGatewayMessageData(JSON.stringify({
      type: "eveng2.session.switch.applied",
      sessionKey: "agent:main:main",
    }))).toEqual({
      type: "eveng2.session.switch.applied",
      sessionKey: "agent:main:main",
    });
  });

  it("returns null for invalid gateway message JSON", () => {
    expect(parseGatewayMessageData("{")).toBeNull();
  });

  it("parses voice gateway message data", () => {
    expect(parseVoiceGatewayMessageData(JSON.stringify({
      event: "transcript.partial",
      text: "hello",
    }))).toEqual({
      event: "transcript.partial",
      text: "hello",
    });
  });

  it("returns null for invalid voice message JSON", () => {
    expect(parseVoiceGatewayMessageData("{")).toBeNull();
  });

  it("matches approval resolution messages to pending approval", () => {
    const current = { type: "eveng2.approval.request" as const, id: "a", requestId: "r" };

    expect(pendingApprovalResolved(current, { type: "eveng2.approval.resolved", id: "a" })).toBe(true);
    expect(pendingApprovalResolved(current, { type: "eveng2.approval.resolved", requestId: "r" })).toBe(true);
    expect(pendingApprovalResolved(current, { type: "eveng2.approval.resolved", id: "other" })).toBe(false);
    expect(pendingApprovalResolved({ type: "eveng2.approval.request" }, { type: "eveng2.approval.resolved" })).toBe(false);
    expect(pendingApprovalResolved(null, { type: "eveng2.approval.resolved", id: "a" })).toBe(false);
  });

  it("summarizes approval acks and error messages", () => {
    expect(approvalResolveAckAccepted({ type: "eveng2.approval.resolve.ack", status: "accepted" })).toBe(true);
    expect(approvalResolveAckAccepted({ type: "eveng2.approval.resolve.ack", status: "rejected" })).toBe(false);
    expect(gatewayErrorStatusFromMessage({ type: "error", error: "bad setup" })).toBe("error: bad setup");
    expect(gatewayErrorStatusFromMessage({
      type: "error",
      error: "higher role than currently approved",
      requestId: "6fbee43c-5f38-4c2b-b7b1-13c121edf0b5",
    })).toBe("error: higher role than currently approved (requestId: 6fbee43c-5f38-4c2b-b7b1-13c121edf0b5)");
  });

  it("derives node approval required state from runtime node snapshots", () => {
    expect(nodeApprovalRequiredFromSnapshot({
      nodeId: "node-even-g2",
      approvalState: "pending-approval",
      pendingRequestId: "13cd37a9-2ab9-42d7-9610-1202afcf1b47",
      openclaw: {
        commands: ["canvas.present", "talk.ptt.once"],
      },
      canvas: {
        commands: ["canvas.present"],
      },
    })).toEqual({
      type: "eveng2.node.approval.required",
      nodeId: "node-even-g2",
      approvalState: "pending-approval",
      commands: ["canvas.present", "talk.ptt.once"],
    });
    expect(nodeApprovalRequiredFromSnapshot({
      approvalState: "approved",
      pendingRequestId: "13cd37a9-2ab9-42d7-9610-1202afcf1b47",
    })).toBeNull();
  });

  it("treats pendingRequestId-only runtime snapshots as node approval required", () => {
    expect(nodeApprovalRequiredFromSnapshot({
      nodeId: "node-even-g2",
      pendingRequestId: "request-pending",
      openclaw: { commands: ["talk.ptt.once"] },
    })).toEqual({
      type: "eveng2.node.approval.required",
      nodeId: "node-even-g2",
      approvalState: "pending-approval",
      commands: ["talk.ptt.once"],
    });
    expect(nodeApprovalRequiredFromSnapshot({
      nodeId: "node-even-g2",
      approvalState: "unapproved",
      pendingRequestId: "request-pending",
    })).toEqual({
      type: "eveng2.node.approval.required",
      nodeId: "node-even-g2",
      approvalState: "unapproved",
      commands: [],
    });
  });

  it("plans approval request, resolution, and ack updates", () => {
    const current = { type: "eveng2.approval.request" as const, id: "a", requestId: "r" };

    expect(gatewayApprovalUpdate(current, null)).toEqual({
      action: "request",
      pendingApproval: current,
      status: "needs approval",
    });
    expect(gatewayApprovalUpdate({
      type: "eveng2.approval.resolved",
      requestId: "r",
    }, current)).toEqual({
      action: "resolved",
      shouldClearPendingApproval: true,
      renderSessionHomeStatus: "approval resolved",
    });
    expect(gatewayApprovalUpdate({
      type: "eveng2.approval.resolved",
      requestId: "other",
    }, current)).toEqual({
      action: "resolved",
      shouldClearPendingApproval: false,
      renderSessionHomeStatus: "",
    });
    expect(gatewayApprovalUpdate({
      type: "eveng2.approval.resolve.ack",
      status: "accepted",
    }, current)).toEqual({
      action: "ack",
      status: "accepted",
      shouldClearPendingApproval: false,
      renderSessionHomeStatus: "",
    });
    expect(gatewayApprovalUpdate({
      type: "eveng2.approval.resolve.ack",
      requestId: "r",
      status: "accepted",
    }, current)).toEqual({
      action: "ack",
      status: "accepted",
      shouldClearPendingApproval: true,
      renderSessionHomeStatus: "approval sent",
    });
  });

  it("extracts session keys from config and switch messages", () => {
    expect(sessionKeyFromConfigOrSwitchMessage({
      type: "eveng2.session.config.snapshot",
      sessionKey: "agent:main:main",
    })).toBe("agent:main:main");
    expect(sessionKeyFromConfigOrSwitchMessage({
      type: "eveng2.session.switch.applied",
      sessionKey: "",
    })).toBe("");
  });

  it("extracts session keys from runtime status messages", () => {
    expect(sessionKeyFromRuntimeStatusMessage({
      type: "eveng2.runtime.status",
      session: "agent:main:main",
    })).toBe("agent:main:main");
    expect(sessionKeyFromRuntimeStatusMessage({
      type: "eveng2.runtime.status",
      session: "",
    })).toBe("");
  });

  it("plans runtime status session updates", () => {
    expect(runtimeStatusSessionUpdate({
      type: "eveng2.runtime.status",
      session: "agent:main:next",
      node: { nodeConnected: true },
    }, "agent:main:main")).toEqual({
      nextSessionKey: "agent:main:next",
      changed: true,
      shouldRequestTranscript: true,
      hasNodeSnapshot: true,
      nodeSnapshot: { nodeConnected: true },
      nodeApprovalRequired: null,
    });
    expect(runtimeStatusSessionUpdate({
      type: "eveng2.runtime.status",
      node: {
        nodeId: "node-even-g2",
        approvalState: "pending-approval",
        pendingRequestId: "13cd37a9-2ab9-42d7-9610-1202afcf1b47",
        openclaw: { commands: ["canvas.present"] },
      },
    }, "agent:main:main")).toMatchObject({
      hasNodeSnapshot: true,
      nodeApprovalRequired: {
        type: "eveng2.node.approval.required",
        nodeId: "node-even-g2",
        approvalState: "pending-approval",
        commands: ["canvas.present"],
      },
    });
    expect(runtimeStatusSessionUpdate({
      type: "eveng2.runtime.status",
      node: {
        nodeId: "node-even-g2",
        pendingRequestId: "request-pending",
      },
    }, "agent:main:main")).toMatchObject({
      nodeApprovalRequired: {
        type: "eveng2.node.approval.required",
        nodeId: "node-even-g2",
        approvalState: "pending-approval",
      },
    });
    expect(runtimeStatusSessionUpdate({
      type: "eveng2.runtime.status",
      session: "agent:main:main",
    }, "agent:main:main")).toEqual({
      nextSessionKey: "agent:main:main",
      changed: false,
      shouldRequestTranscript: false,
      hasNodeSnapshot: false,
      nodeSnapshot: null,
      nodeApprovalRequired: null,
    });
    expect(runtimeStatusSessionUpdate({
      type: "eveng2.runtime.status",
      node: null,
    }, "agent:main:main")).toEqual({
      nextSessionKey: "",
      changed: false,
      shouldRequestTranscript: false,
      hasNodeSnapshot: true,
      nodeSnapshot: null,
      nodeApprovalRequired: null,
    });
  });

  it("classifies explicit node approval states", () => {
    expect(nodeApprovalStateApproved("approved")).toBe(true);
    expect(nodeApprovalStateApproved("pending-approval")).toBe(false);
    expect(nodeApprovalStateExplicitlyReady("approved")).toBe(true);
    expect(nodeApprovalStateExplicitlyReady("ready")).toBe(true);
    expect(nodeApprovalStateExplicitlyReady("pending-approval")).toBe(false);
    expect(nodeApprovalStateExplicitlyReady("pending-reapproval")).toBe(false);
    expect(nodeApprovalStateExplicitlyReady("unapproved")).toBe(false);
    expect(nodeApprovalStateExplicitlyReady("not-approved")).toBe(false);
    expect(nodeApprovalStateExplicitlyReady(undefined)).toBe(false);
  });

  it("clears pending node approval metadata from ready snapshots", () => {
    const ready = nodeApprovalReadySnapshot({
      nodeId: "node-even-g2",
      approvalState: "pending-approval",
      pendingRequestId: "13cd37a9-2ab9-42d7-9610-1202afcf1b47",
      openclaw: { commands: ["canvas.present"] },
    });

    expect(ready).toEqual({
      nodeId: "node-even-g2",
      approvalState: "approved",
      openclaw: { commands: ["canvas.present"] },
    });
    expect(nodeApprovalRequiredFromSnapshot(ready)).toBeNull();
  });

  it("plans session config and switch updates", () => {
    expect(sessionConfigOrSwitchUpdate({
      type: "eveng2.session.config.snapshot",
      sessionKey: "agent:main:next",
    }, "agent:main:main")).toEqual({
      nextSessionKey: "agent:main:next",
      changed: true,
      shouldResetTranscript: true,
      shouldRequestTranscript: true,
      shouldRenderSessionHomeReady: false,
    });
    expect(sessionConfigOrSwitchUpdate({
      type: "eveng2.session.switch.applied",
      sessionKey: "agent:main:main",
    }, "agent:main:main")).toEqual({
      nextSessionKey: "agent:main:main",
      changed: false,
      shouldResetTranscript: false,
      shouldRequestTranscript: true,
      shouldRenderSessionHomeReady: true,
    });
    expect(sessionConfigOrSwitchUpdate({
      type: "eveng2.session.switch.applied",
      sessionKey: "",
    }, "agent:main:main")).toMatchObject({
      nextSessionKey: "",
      shouldRequestTranscript: false,
    });
  });

  it("matches send acks to the current session when needed", () => {
    expect(sessionSendAckMatchesCurrentSession({
      type: "eveng2.session.send.ack",
      sessionKey: "agent:main:main",
    }, "agent:main:main")).toBe(true);
    expect(sessionSendAckMatchesCurrentSession({
      type: "eveng2.session.send.ack",
      sessionKey: "agent:main:other",
    }, "agent:main:main")).toBe(false);
    expect(sessionSendAckMatchesCurrentSession({
      type: "eveng2.session.send.ack",
    }, "agent:main:main")).toBe(true);
  });
});
