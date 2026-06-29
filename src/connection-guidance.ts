import { shortText } from "./glass";

export type ConnectionGuidance = {
  title: string;
  body: string;
  action?: string;
};

export type ConnectionHudFrame = {
  header: string;
  body: string;
  hint: string;
};

export type ConnectionErrorPresentationPlan =
  | {
    target: "guidance";
    statusText: string;
    guidance: ConnectionGuidance;
    reconnectReason: "needs attention" | "";
  }
  | {
    target: "glass-error";
    statusText: string;
    frame: ConnectionHudFrame;
    reconnectReason: "needs attention";
  };

function connectionHudFrameToText(frame: ConnectionHudFrame) {
  return [frame.header, "", frame.body, "", frame.hint].filter(Boolean).join("\n");
}

const OPENCLAW_AGENT_REPO_HINT = "See solavrc/openclaw-even-g2-node.";
const REQUEST_ID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const SAFE_REQUEST_ID_PATTERN = /^[a-z0-9][a-z0-9._:-]*$/i;
const REQUEST_ID_PLACEHOLDER = "<requestId>";

function looksLikeIncompleteUuid(requestId: string) {
  return requestId.includes("-") && /^[0-9a-f-]+$/i.test(requestId) && !REQUEST_ID_PATTERN.test(requestId);
}

function concreteRequestId(requestId: string) {
  const trimmed = requestId.trim();
  return SAFE_REQUEST_ID_PATTERN.test(trimmed) && !looksLikeIncompleteUuid(trimmed) ? trimmed : REQUEST_ID_PLACEHOLDER;
}

function requestIdFrom(statusText: string, allowNonUuidRequestId = false) {
  const match = statusText.match(new RegExp(`requestId:\\s*(${REQUEST_ID_PATTERN.source})`, "i"))
    || statusText.match(new RegExp(`request(?:\\s+)?id[:=]\\s*(${REQUEST_ID_PATTERN.source})`, "i"));
  if (match?.[1]) return match[1];
  if (!allowNonUuidRequestId) return REQUEST_ID_PLACEHOLDER;
  const tokenMatch = statusText.match(/requestId:\s*([a-z0-9][a-z0-9._:-]*)\s*(?:\)|$|\s)/i)
    || statusText.match(/request(?:\s+)?id[:=]\s*([a-z0-9][a-z0-9._:-]*)\s*(?:\)|$|\s)/i);
  return tokenMatch?.[1] ? concreteRequestId(tokenMatch[1]) : REQUEST_ID_PLACEHOLDER;
}

function hasConcreteRequestId(requestId: string) {
  return concreteRequestId(requestId) !== REQUEST_ID_PLACEHOLDER;
}

function conversationalApprovalRequest(kind: "device" | "operator" | "node") {
  if (kind === "node") return `Hey Claw, approve remaining Even G2 node tools. ${OPENCLAW_AGENT_REPO_HINT}`;
  if (kind === "operator") return `Hey Claw, approve remaining Even G2 operator requests. ${OPENCLAW_AGENT_REPO_HINT}`;
  return `Hey Claw, approve my pending Even G2 setup. ${OPENCLAW_AGENT_REPO_HINT}`;
}

function conversationalSetupRequest() {
  return `Hey Claw, show my Even G2 setup QR. ${OPENCLAW_AGENT_REPO_HINT}`;
}

function openClawAskBody(request: string) {
  return ["Ask OpenClaw with:", `"${request}"`].join("\n");
}

function hostCommand(approveCommand: string, discoveryCommand: string, requestId: string, askPhrase: string) {
  const approvedRequestId = concreteRequestId(requestId);
  const approveLine = hasConcreteRequestId(approvedRequestId)
    ? `\`$ ${approveCommand} ${approvedRequestId}\``
    : `Find the Even G2 request, then run \`${approveCommand} <requestId>\``;
  return [
    "Run on OpenClaw host:",
    `\`$ ${discoveryCommand}\``,
    approveLine,
    "",
    "Or ask OpenClaw:",
    `"${askPhrase}"`,
  ].filter(Boolean).join("\n");
}

export function setupHudFrame(): ConnectionHudFrame {
  return {
    header: "OpenClaw Node",
    body: openClawAskBody(conversationalSetupRequest()),
    hint: "scan QR on phone",
  };
}

export function setupHudText() {
  return connectionHudFrameToText(setupHudFrame());
}

export function gatewayConnectingHudFrame(): ConnectionHudFrame {
  return {
    header: "OpenClaw Node",
    body: "Connecting to OpenClaw Gateway.",
    hint: "wait...",
  };
}

export function setupCodeMissingHudFrame(): ConnectionHudFrame {
  return {
    header: "OpenClaw Node",
    body: "Setup code missing.",
    hint: "paste setup code on phone",
  };
}

export function setupCodeInvalidHudFrame(message: string): ConnectionHudFrame {
  return {
    header: "OpenClaw Node",
    body: `Setup code invalid.\n${shortText(message, 96)}`,
    hint: "scan or paste again",
  };
}

export function setupQrScannedHudFrame(): ConnectionHudFrame {
  return {
    header: "OpenClaw Node",
    body: "Setup QR scanned.\nConnecting to OpenClaw Gateway.",
    hint: "wait...",
  };
}

export function setupQrScanPromptHudFrame(): ConnectionHudFrame {
  return {
    header: "OpenClaw Node",
    body: "Scan setup QR.\nPoint this phone at the QR shown by OpenClaw host.",
    hint: "use phone camera",
  };
}

export function setupQrNotFoundHudFrame(): ConnectionHudFrame {
  return {
    header: "QR not found",
    body: "Keep QR fully visible.",
    hint: "try again",
  };
}

export function setupQrScanFailedHudFrame(message: string): ConnectionHudFrame {
  return {
    header: "QR scan failed",
    body: shortText(message, 180),
    hint: "try again",
  };
}

function guidanceHudFrame(title: string, bodyRows: string[], hint: string): ConnectionHudFrame {
  return {
    header: title.replace(/`/g, ""),
    body: bodyRows.filter(Boolean).map((line) => line.replace(/`/g, "")).join("\n"),
    hint: hint.replace(/`/g, ""),
  };
}

function setupConnectionGuidance(): ConnectionGuidance {
  return {
    title: "OpenClaw Node",
    body: "Set up OpenClaw Gateway from the host, then scan the setup QR with this phone.",
    action: [
      "Run on OpenClaw host:",
      "`$ openclaw qr`",
      "",
      "Or ask OpenClaw:",
      `"${conversationalSetupRequest()}"`,
      "",
      "Then tap Scan setup QR on this phone.",
    ].join("\n"),
  };
}

function operatorApprovalGuidance(requestId: string): ConnectionGuidance {
  return {
    title: "Operator approval required",
    body: "This is the second device approval. Approve the operator request so this phone can read sessions and send voice input.",
    action: hostCommand("openclaw devices approve", "openclaw devices list", requestId, conversationalApprovalRequest("operator")),
  };
}

export function nodeApprovalGuidance(): ConnectionGuidance {
  return {
    title: "Node approval required",
    body: "The device and operator are trusted. Approve the node command request so OpenClaw can use Even G2 tools like canvas and push-to-talk.",
    action: hostCommand("openclaw nodes approve", "openclaw nodes pending", REQUEST_ID_PLACEHOLDER, conversationalApprovalRequest("node")),
  };
}

function deviceApprovalGuidance(requestId: string): ConnectionGuidance {
  return {
    title: "Device approval required",
    body: "First, trust the Even G2 device identity. A second operator approval may follow.",
    action: hostCommand("openclaw devices approve", "openclaw devices list", requestId, conversationalApprovalRequest("device")),
  };
}

function originBlockGuidance(): ConnectionGuidance {
  return {
    title: "Allow this app origin",
    body: "The phone reached OpenClaw, but the Gateway rejected this WebView origin.",
    action: [
      "On the OpenClaw host, add the App origin shown on this phone to gateway.controlUi.allowedOrigins.",
      "Also confirm this phone can reach the Gateway URL through the same secure route.",
      "Then tap Retry now.",
    ].join("\n"),
  };
}

function authenticationPausedGuidance(statusText: string): ConnectionGuidance {
  return {
    title: "OpenClaw authentication paused",
    body: statusText.replace(/^error:\s*/i, ""),
    action: [
      "Stop app briefly to pause retries.",
      "Use Retry now when the Gateway is ready.",
      "On OpenClaw host:",
      "`$ openclaw devices list`",
      "`$ openclaw nodes pending`",
      "Approve pending Even G2 requests or reset pairing.",
    ].join("\n"),
  };
}

function evenHubNetworkPermissionGuidance(): ConnectionGuidance {
  return {
    title: "Even Hub network permission likely blocked",
    body: "The setup code was accepted, but the app appears blocked before the Gateway could answer.",
    action: [
      "Confirm the Gateway URL works from this phone outside Even Hub.",
      "If it works there, capture Advanced diagnostics and check the Even Hub network permission for this origin.",
      "Use a secure WSS route for non-local Gateway access.",
    ].join("\n"),
  };
}

function gatewayUnreachableGuidance(): ConnectionGuidance {
  return {
    title: "Gateway unreachable from phone",
    body: "The setup code was accepted, but this phone could not complete the Gateway WebSocket connection.",
    action: [
      "Confirm the Gateway URL is reachable from this phone network.",
      "Use a secure WSS route for remote access; plain WS should be local development only.",
      "Check VPN/tailnet state, Gateway status, and browser/server CORS.",
    ].join("\n"),
  };
}

export function guidanceForConnectionState(statusText: string, hasSetupCode: boolean): ConnectionGuidance | null {
  const normalized = statusText.toLowerCase();
  if (!hasSetupCode || normalized.includes("setup code is empty")) {
    return setupConnectionGuidance();
  }
  if (normalized.includes("higher role") || normalized.includes("role-upgrade") || normalized.includes("role upgrade")) {
    const requestId = requestIdFrom(statusText, true);
    return operatorApprovalGuidance(requestId);
  }
  if (normalized.includes("node") && (normalized.includes("approval") || normalized.includes("not approved") || normalized.includes("unapproved"))) {
    return nodeApprovalGuidance();
  }
  if (normalized.includes("origin not allowed") || normalized.includes("allowedorigins")) {
    return originBlockGuidance();
  }
  if (normalized.includes("not approved yet") || normalized.includes("pairing required")) {
    const requestId = requestIdFrom(statusText);
    return deviceApprovalGuidance(requestId);
  }
  if (
    normalized.includes("network whitelist") ||
    normalized.includes("network permission") ||
    normalized.includes("manifest") ||
    normalized.includes("app permission") ||
    normalized.includes("permission denied") ||
    normalized.includes("not in whitelist")
  ) {
    return evenHubNetworkPermissionGuidance();
  }
  if (
    normalized.includes("websocket") ||
    normalized.includes("network") ||
    normalized.includes("connection error") ||
    normalized.includes("failed to fetch") ||
    normalized.includes("timed out") ||
    normalized.includes("gateway session closed")
  ) {
    return gatewayUnreachableGuidance();
  }
  if (normalized.includes("too many failed authentication attempts")) {
    return authenticationPausedGuidance(statusText);
  }
  if (normalized.startsWith("error:")) {
    return {
      title: "OpenClaw connection needs attention",
      body: statusText.replace(/^error:\s*/i, ""),
      action: "Check OpenClaw Gateway status. This app will retry while the setup code remains configured.",
    };
  }
  return null;
}

export function connectionErrorPresentationPlan(
  statusText: string,
  errorText: string,
  hasSetupCode: boolean,
): ConnectionErrorPresentationPlan {
  const guidance = guidanceForConnectionState(statusText, hasSetupCode);
  if (guidance) {
    return {
      target: "guidance",
      statusText,
      guidance,
      reconnectReason: guidance.title === "OpenClaw authentication paused" ? "" : "needs attention",
    };
  }
  return {
    target: "glass-error",
    statusText,
    frame: {
      header: "OpenClaw error",
      body: shortText(errorText, 180),
      hint: "retrying...",
    },
    reconnectReason: "needs attention",
  };
}

export function connectionGuidanceHudFrame(guidance: ConnectionGuidance): ConnectionHudFrame {
  const isPairingStep = /^(?:Device|Operator|Node|Role|Extra) approval required$/.test(guidance.title);
  if (guidance.title === "OpenClaw Node") {
    return setupHudFrame();
  }
  if (isPairingStep) {
    const askLine = guidance.action
      ?.split("\n")
      .map((line) => line.trim())
      .find((line) => /^"Hey Claw,/.test(line))
      ?.replace(/^"|"$/g, "");
    return guidanceHudFrame(
      guidance.title,
      [openClawAskBody(askLine || "Approve this Even G2 setup.")],
      "ask OpenClaw",
    );
  }
  return guidanceHudFrame(
    guidance.title,
    [guidance.body, ...(guidance.action ? guidance.action.split("\n") : [])],
    "retrying...",
  );
}

export function connectionGuidanceHudText(guidance: ConnectionGuidance) {
  const frame = connectionGuidanceHudFrame(guidance);
  return connectionHudFrameToText({
    header: frame.header.replace(/`/g, ""),
    body: frame.body.replace(/`/g, ""),
    hint: frame.hint.replace(/`/g, ""),
  });
}
