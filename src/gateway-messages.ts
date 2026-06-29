import type { OpenClawSession, SessionTranscriptMessage } from "./glass";

export type EvenG2NodeSnapshot = {
  nodeId?: string;
  deviceId?: string;
  displayName?: string;
  nodeConnected?: boolean;
  connected?: boolean;
  paired?: boolean;
  approvalState?: string;
  pendingRequestId?: string;
  connectedAtMs?: number;
  lastSeenAtMs?: number;
  lastSeenReason?: string;
  approvedAtMs?: number;
  foreground?: {
    clientCount?: number;
  };
  voice?: {
    enabled?: boolean;
    transport?: string;
  };
  canvas?: {
    enabled?: boolean;
    mode?: string;
    commands?: string[];
    bridgeRequired?: boolean;
  };
  openclaw?: {
    nodeEnabled?: boolean;
    commands?: string[];
    lastError?: string | null;
    lastConnectedAt?: string | null;
    lastDisconnectedAt?: string | null;
  };
};

export type GatewayMessage =
  | { type: "ready"; clientId?: string; service?: string }
  | { type: "eveng2.runtime.status"; clientId?: string; service?: string; session?: string; node?: EvenG2NodeSnapshot | null; clientCount?: number }
  | { type: "eveng2.approval.request"; id?: string; requestId?: string; command?: string; cwd?: string | null; ask?: string | null; security?: string | null }
  | { type: "eveng2.approval.resolved"; id?: string; requestId?: string; decision?: string | null }
  | { type: "eveng2.approval.resolve.ack"; id?: string; requestId?: string; decision?: string | null; status: string; message?: string | null; error?: string }
  | { type: "eveng2.session.config.snapshot"; sessionKey?: string; modelProvider?: string | null; model?: string | null }
  | { type: "eveng2.session.list.result"; sessions?: OpenClawSession[] }
  | { type: "eveng2.session.switch.applied"; sessionKey?: string }
  | { type: "eveng2.session.create.failed"; error: string }
  | { type: "eveng2.session.transcript.snapshot"; sessionKey?: string; sessionId?: string | null; messages?: SessionTranscriptMessage[]; rawLimit?: number; rawCount?: number; hasFullHistory?: boolean; fetchedAtMs?: number; stale?: boolean; error?: string }
  | { type: "eveng2.session.send.ack"; sessionKey?: string; message?: string }
  | { type: "eveng2.session.voice.sent"; sessionKey?: string; idempotencyKey?: string }
  | { type: "eveng2.node.command"; id?: string; nodeId?: string; command?: string; params?: Record<string, unknown>; timeoutMs?: number }
  | { type: "eveng2.node.approval.required"; nodeId?: string; requestId?: string; approvalState?: string; commands?: string[] }
  | { type: "eveng2.node.approval.ready" }
  | { type: "error"; id?: string; error: string; pauseReconnect?: boolean }
  | { type: "pong"; ts: number };

export type GatewayTransport = Pick<WebSocket, "readyState" | "send" | "close" | "addEventListener"> & {
  canSendNodeCommandResult?: () => boolean;
  request?: <T = unknown>(method: string, params?: unknown, timeoutMs?: number) => Promise<T>;
};

export type VoiceTransport = Pick<WebSocket, "readyState" | "send" | "close" | "addEventListener"> & {
  open?: () => Promise<void>;
};

export type VoiceGatewayMessage = {
  type?: string;
  event?: string;
  text?: string;
  error?: string;
  code?: string;
  phase?: string;
  transport?: string;
  sessionKey?: string;
  targetSessionKey?: string;
  idempotencyKey?: string;
};

export type PendingApproval = Extract<GatewayMessage, { type: "eveng2.approval.request" }>;
export type GatewayApprovalResolvedMessage = Extract<GatewayMessage, { type: "eveng2.approval.resolved" }>;
export type GatewayApprovalResolveAckMessage = Extract<GatewayMessage, { type: "eveng2.approval.resolve.ack" }>;
export type NodeApprovalRequired = Extract<GatewayMessage, { type: "eveng2.node.approval.required" }>;
export type NodeCommandMessage = Extract<GatewayMessage, { type: "eveng2.node.command" }>;
export type GatewayRuntimeStatusMessage = Extract<GatewayMessage, { type: "eveng2.runtime.status" }>;
export type GatewayReadyOrRuntimeStatusMessage = Extract<GatewayMessage, { type: "ready" | "eveng2.runtime.status" }>;
export type GatewayNodeApprovalMessage = Extract<GatewayMessage, { type: "eveng2.node.approval.required" | "eveng2.node.approval.ready" }>;
export type GatewaySessionConfigOrSwitchMessage = Extract<GatewayMessage, {
  type: "eveng2.session.config.snapshot" | "eveng2.session.switch.applied";
}>;
export type GatewaySessionMessage = Extract<GatewayMessage, {
  type:
    | "eveng2.session.config.snapshot"
    | "eveng2.session.switch.applied"
    | "eveng2.session.create.failed"
    | "eveng2.session.list.result"
    | "eveng2.session.transcript.snapshot"
    | "eveng2.session.send.ack";
}>;
export type GatewaySessionListResultMessage = Extract<GatewayMessage, { type: "eveng2.session.list.result" }>;
export type GatewaySessionTranscriptSnapshotMessage = Extract<GatewayMessage, { type: "eveng2.session.transcript.snapshot" }>;
export type GatewaySessionSendAckMessage = Extract<GatewayMessage, { type: "eveng2.session.send.ack" }>;
export type GatewayApprovalMessage = Extract<GatewayMessage, {
  type: "eveng2.approval.request" | "eveng2.approval.resolved" | "eveng2.approval.resolve.ack";
}>;
export type GatewayErrorMessage = Extract<GatewayMessage, { type: "error" }>;

export function parseGatewayMessageData(data: unknown): GatewayMessage | null {
  try {
    return JSON.parse(String(data)) as GatewayMessage;
  } catch {
    return null;
  }
}

export function parseVoiceGatewayMessageData(data: unknown): VoiceGatewayMessage | null {
  try {
    return JSON.parse(String(data)) as VoiceGatewayMessage;
  } catch {
    return null;
  }
}

export function pendingApprovalResolved(
  current: PendingApproval | null,
  resolved: GatewayApprovalResolvedMessage,
) {
  return approvalMessagesMatch(current, resolved);
}

export function approvalResolveAckAccepted(
  ack: GatewayApprovalResolveAckMessage,
) {
  return ack.status === "accepted";
}

function approvalMessagesMatch(
  current: PendingApproval | null,
  message: Pick<GatewayApprovalResolvedMessage | GatewayApprovalResolveAckMessage, "id" | "requestId">,
) {
  if (!current) return false;
  return Boolean(
    (current.id && message.id && current.id === message.id)
    || (current.requestId && message.requestId && current.requestId === message.requestId),
  );
}

export type GatewayApprovalUpdate =
  | {
    action: "request";
    pendingApproval: PendingApproval;
    status: "needs approval";
  }
  | {
    action: "resolved";
    shouldClearPendingApproval: boolean;
    renderSessionHomeStatus: "approval resolved" | "";
  }
  | {
    action: "ack";
    status: string;
    shouldClearPendingApproval: boolean;
    renderSessionHomeStatus: "approval sent" | "";
  };

export function gatewayApprovalUpdate(
  message: GatewayApprovalMessage,
  current: PendingApproval | null,
): GatewayApprovalUpdate {
  if (message.type === "eveng2.approval.request") {
    return {
      action: "request",
      pendingApproval: message,
      status: "needs approval",
    };
  }
  if (message.type === "eveng2.approval.resolved") {
    const resolved = pendingApprovalResolved(current, message);
    return {
      action: "resolved",
      shouldClearPendingApproval: resolved,
      renderSessionHomeStatus: resolved ? "approval resolved" : "",
    };
  }
  const accepted = approvalResolveAckAccepted(message);
  const shouldClearPendingApproval = accepted && approvalMessagesMatch(current, message);
  return {
    action: "ack",
    status: message.status,
    shouldClearPendingApproval,
    renderSessionHomeStatus: shouldClearPendingApproval ? "approval sent" : "",
  };
}

export function gatewayErrorStatusFromMessage(message: GatewayErrorMessage) {
  return `error: ${message.error}`;
}

export function sessionKeyFromConfigOrSwitchMessage(
  message: GatewaySessionConfigOrSwitchMessage,
) {
  return typeof message.sessionKey === "string" && message.sessionKey ? message.sessionKey : "";
}

export function sessionKeyFromRuntimeStatusMessage(
  message: GatewayRuntimeStatusMessage,
) {
  return typeof message.session === "string" && message.session ? message.session : "";
}

export function runtimeStatusSessionUpdate(
  message: GatewayRuntimeStatusMessage,
  currentSessionKey: string,
) {
  const nextSessionKey = sessionKeyFromRuntimeStatusMessage(message);
  const hasNodeSnapshot = Object.prototype.hasOwnProperty.call(message, "node");
  return {
    nextSessionKey,
    changed: Boolean(nextSessionKey && nextSessionKey !== currentSessionKey),
    shouldRequestTranscript: Boolean(nextSessionKey && nextSessionKey !== currentSessionKey),
    hasNodeSnapshot,
    nodeSnapshot: hasNodeSnapshot ? message.node || null : null,
  };
}

export function sessionConfigOrSwitchUpdate(
  message: GatewaySessionConfigOrSwitchMessage,
  currentSessionKey: string,
) {
  const nextSessionKey = sessionKeyFromConfigOrSwitchMessage(message);
  const changed = Boolean(nextSessionKey && nextSessionKey !== currentSessionKey);
  return {
    nextSessionKey,
    changed,
    shouldResetTranscript: changed,
    shouldRequestTranscript: Boolean(nextSessionKey),
    shouldRenderSessionHomeReady: message.type === "eveng2.session.switch.applied",
  };
}

export function sessionSendAckMatchesCurrentSession(
  message: GatewaySessionSendAckMessage,
  currentSessionKey: string,
) {
  return !message.sessionKey || message.sessionKey === currentSessionKey;
}
