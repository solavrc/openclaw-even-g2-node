export function connectionStateLabel(connected: boolean) {
  return connected ? "Connected" : "Disconnected";
}

export function hasGatewaySetup(gatewayUrl: string) {
  return Boolean(gatewayUrl.trim());
}

export function nodeStatusLabel(input: {
  connected: boolean;
  nodeConnected: boolean;
  foregroundClientCount: number;
  lastError?: string | null;
}) {
  if (!input.connected) return "Gateway disconnected";
  if (input.nodeConnected) {
    return input.foregroundClientCount > 0 ? "Paired · G2 bridge live" : "Paired · G2 bridge unavailable";
  }
  return input.lastError ? "Pairing attention needed" : "Pairing status unknown";
}

export function nodeDetailText(input: {
  lastError?: string | null;
  hasGatewaySetup: boolean;
  activeSessionLabel: string;
}) {
  if (input.lastError) return input.lastError;
  return input.hasGatewaySetup ? `Session: ${input.activeSessionLabel}` : "Setup QR has not been scanned yet.";
}

export function retryStatusLabel(retryDueAtMs: number | null, retryClockMs: number) {
  if (retryDueAtMs === null) return "";
  const retrySeconds = Math.max(0, Math.ceil((retryDueAtMs - retryClockMs) / 1000));
  return retrySeconds > 0 ? `Auto retry in ~${retrySeconds}s` : "Retrying now...";
}

export function shouldShowCanvasTutorial(input: {
  pending: boolean;
  completed: boolean;
  showSetupFlow: boolean;
}) {
  return input.pending && !input.completed && !input.showSetupFlow;
}

export function liveStateLabel(input: {
  hasGatewaySetup: boolean;
  connected: boolean;
  nodeApprovalPending?: boolean;
  nodeConnected: boolean;
}) {
  if (!input.hasGatewaySetup) return "Setup required";
  if (input.connected && input.nodeApprovalPending) return "Node approval required";
  return input.connected ? input.nodeConnected ? "Ready" : "Connecting" : "Needs attention";
}

export function liveActionLabel(input: {
  showSetupFlow: boolean;
  showCheckAgain: boolean;
  showRetryNow: boolean;
  showVoiceSetup: boolean;
}) {
  if (input.showSetupFlow) return "Scan setup QR";
  if (input.showRetryNow) return "Retry now";
  if (input.showCheckAgain) return "Check again";
  if (input.showVoiceSetup) return "Set up voice";
  return "";
}

export type ConnectionIssueKind =
  | "setup-required"
  | "ready"
  | "approval-required"
  | "origin-not-allowed"
  | "even-hub-network-permission"
  | "gateway-unreachable"
  | "auth-paused"
  | "gateway-error";

export type ReadinessTone = "ready" | "pending" | "attention" | "blocked" | "optional";

export type ReadinessChecklistItem = {
  label: string;
  detail: string;
  status: string;
  tone: ReadinessTone;
};

export function connectionIssueKind(input: {
  connected: boolean;
  hasGatewaySetup: boolean;
  status: string;
}): ConnectionIssueKind {
  if (!input.hasGatewaySetup) return "setup-required";
  const normalized = input.status.toLowerCase();
  if (normalized.includes("origin not allowed") || normalized.includes("allowedorigins")) return "origin-not-allowed";
  if (normalized.includes("too many failed authentication attempts")) return "auth-paused";
  if (
    normalized.includes("higher role") ||
    normalized.includes("role-upgrade") ||
    normalized.includes("role upgrade") ||
    normalized.includes("not approved yet") ||
    normalized.includes("pairing required") ||
    (normalized.includes("node") && (
      normalized.includes("approval") ||
      normalized.includes("not approved") ||
      normalized.includes("unapproved")
    ))
  ) return "approval-required";
  if (input.connected) return "ready";
  if (
    normalized.includes("network whitelist") ||
    normalized.includes("network permission") ||
    normalized.includes("manifest") ||
    normalized.includes("app permission") ||
    normalized.includes("permission denied") ||
    normalized.includes("not in whitelist")
  ) return "even-hub-network-permission";
  if (
    normalized.includes("websocket") ||
    normalized.includes("network") ||
    normalized.includes("connection error") ||
    normalized.includes("failed to fetch") ||
    normalized.includes("timed out") ||
    normalized.includes("gateway session closed")
  ) return "gateway-unreachable";
  return normalized.startsWith("error:") ? "gateway-error" : "gateway-unreachable";
}

export function gatewayRouteSecurityLabel(gatewayUrl: string) {
  const trimmed = gatewayUrl.trim();
  if (!trimmed) return "no Gateway URL";
  try {
    const url = new URL(trimmed);
    if (url.protocol === "wss:") return "secure WSS route";
    if (url.protocol === "ws:") return "plain WS route";
    return `${url.protocol.replace(":", "").toUpperCase()} route`;
  } catch {
    return "setup code stored";
  }
}

function gatewayRouteDetail(gatewayUrl: string) {
  const security = gatewayRouteSecurityLabel(gatewayUrl);
  if (security === "plain WS route") return "Use plain WS only for local development; use WSS for remote phone access.";
  if (security === "secure WSS route") return "Confirm this phone can reach the same secure Gateway route.";
  return "Scan setup QR or paste a fresh setup code.";
}

export function readinessChecklist(input: {
  connected: boolean;
  connectionIssue: ConnectionIssueKind;
  connectionGuidanceTitle?: string;
  foregroundClientCount: number;
  gatewayUrl: string;
  hasGatewaySetup: boolean;
  nodeApprovalPending: boolean;
  nodeConnected: boolean;
  reviewStatusState: "unknown" | "checking" | "ready" | "needs-setup" | "unavailable";
  reviewVoiceVerified: boolean;
  sessionKey: string;
  showCanvasTutorial: boolean;
  voiceMode: "review" | "direct" | "off";
}): ReadinessChecklistItem[] {
  const setup: ReadinessChecklistItem = input.hasGatewaySetup
    ? { label: "Gateway setup", status: "Done", detail: gatewayRouteSecurityLabel(input.gatewayUrl), tone: "ready" }
    : { label: "Gateway setup", status: "Needed", detail: "Scan the OpenClaw setup QR from this phone.", tone: "pending" };

  const route: ReadinessChecklistItem = (() => {
    if (!input.hasGatewaySetup) return { label: "Phone reachability", status: "Waiting", detail: "Scan setup QR first.", tone: "pending" };
    if (input.connected) return { label: "Phone reachability", status: "Connected", detail: "The Gateway WebSocket is open from this phone.", tone: "ready" };
    if (input.connectionIssue === "origin-not-allowed") {
      return { label: "App origin", status: "Blocked", detail: "Add this App origin to gateway.controlUi.allowedOrigins, then retry.", tone: "attention" };
    }
    if (input.connectionIssue === "even-hub-network-permission") {
      return { label: "Even Hub network", status: "Blocked", detail: "Gateway may be reachable outside Even Hub but blocked by package network permission.", tone: "blocked" };
    }
    if (input.connectionIssue === "gateway-unreachable") {
      return { label: "Phone reachability", status: "Check route", detail: gatewayRouteDetail(input.gatewayUrl), tone: "attention" };
    }
    if (input.connectionIssue === "auth-paused") {
      return { label: "Gateway auth", status: "Paused", detail: "Approve pending requests or reset pairing, then Retry now.", tone: "attention" };
    }
    return { label: "Gateway route", status: "Needs attention", detail: "Check Gateway status, phone reachability, and the stored setup code.", tone: "attention" };
  })();

  const approvalPending = input.connectionGuidanceTitle === "Device approval required" ||
    input.connectionGuidanceTitle === "Operator approval required" ||
    (input.connectionIssue === "approval-required" && !input.nodeApprovalPending);
  const approval: ReadinessChecklistItem = approvalPending
    ? { label: "Device/operator approval", status: "Pending", detail: "Approve the pending Even G2 request on the OpenClaw host or ask OpenClaw.", tone: "attention" }
    : input.connected
      ? { label: "Device/operator approval", status: "Trusted", detail: "Operator session can read and write the selected OpenClaw session.", tone: "ready" }
      : { label: "Device/operator approval", status: "Waiting", detail: "Gateway must connect before this can be confirmed.", tone: "pending" };

  const nodeTools: ReadinessChecklistItem = input.nodeApprovalPending
    ? { label: "Node tools approval", status: "Pending", detail: "Approve Even G2 node tools so canvas and push-to-talk can run.", tone: "attention" }
    : input.connected && input.nodeConnected
      ? { label: "Node tools approval", status: "Ready", detail: "OpenClaw can route Even G2 node commands.", tone: "ready" }
      : { label: "Node tools approval", status: "Waiting", detail: "Connect Gateway and finish node approval if OpenClaw asks.", tone: "pending" };

  const selectedSession: ReadinessChecklistItem = input.connected && input.sessionKey
    ? { label: "Selected session", status: "Ready", detail: input.sessionKey, tone: "ready" }
    : { label: "Selected session", status: "Waiting", detail: "The first glasses view appears after the operator session connects.", tone: "pending" };

  const bridge: ReadinessChecklistItem = input.connected && input.nodeConnected && input.foregroundClientCount > 0
    ? { label: "G2 bridge", status: "Live", detail: "Canvas, glasses input, and push-to-talk can use the active glasses app.", tone: "ready" }
    : input.connected && input.nodeConnected
      ? { label: "G2 bridge", status: "Unavailable", detail: "Open OpenClaw Node on the glasses for canvas and push-to-talk.", tone: "attention" }
      : { label: "G2 bridge", status: "Waiting", detail: "Bridge state is confirmed after the node session connects.", tone: "pending" };

  const canvasTutorial: ReadinessChecklistItem | null = input.showCanvasTutorial
    ? { label: "Canvas tutorial", status: "Optional", detail: "Ask OpenClaw to send a tiny visual surprise, or tap on the glasses to skip.", tone: "optional" }
    : null;

  const voice: ReadinessChecklistItem = (() => {
    if (input.voiceMode === "off") return { label: "Voice verification", status: "Off", detail: "Enable Voice input after session setup if needed.", tone: "optional" };
    if (!input.hasGatewaySetup) return { label: "Voice verification", status: "Later", detail: "Voice setup is checked after Gateway pairing.", tone: "optional" };
    if (input.voiceMode === "direct") {
      return { label: "Voice verification", status: "Send now selected", detail: "Make one short recording to confirm audio attachment handling in OpenClaw.", tone: "optional" };
    }
    if (input.reviewVoiceVerified && input.reviewStatusState === "ready") {
      return { label: "Voice verification", status: "Verified", detail: "Review returned transcript text during this app session.", tone: "ready" };
    }
    if (input.reviewStatusState === "ready") {
      return { label: "Voice verification", status: "Record once", detail: "talk.catalog is listed; make one short Review recording to verify live transcript.", tone: "pending" };
    }
    if (input.reviewStatusState === "needs-setup" || input.reviewStatusState === "unavailable") {
      return { label: "Voice verification", status: "Setup needed", detail: "Use Set up voice, then send the setup request to OpenClaw before relying on Review.", tone: "attention" };
    }
    return { label: "Voice verification", status: "Checking", detail: "Connect Gateway so the app can read talk.catalog.", tone: "pending" };
  })();

  return [
    setup,
    route,
    approval,
    nodeTools,
    selectedSession,
    bridge,
    ...(canvasTutorial ? [canvasTutorial] : []),
    voice,
  ];
}

export function selectedReviewProviderMissing(
  preferredReviewProvider: string,
  providers: Array<{ id: string }>,
) {
  return Boolean(preferredReviewProvider && !providers.some((provider) => provider.id === preferredReviewProvider));
}

export function voiceFailureErrorText(error: string) {
  return error.replace(/^error:\s*/i, "").trim();
}
