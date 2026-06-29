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
    reconnectReason: "needs attention";
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

const REQUEST_ID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

function requestIdFrom(statusText: string) {
  const match = statusText.match(new RegExp(`requestId:\\s*(${REQUEST_ID_PATTERN.source})`, "i"))
    || statusText.match(new RegExp(`request(?:\\s+)?id[:=]\\s*(${REQUEST_ID_PATTERN.source})`, "i"));
  return match?.[1] || "<requestId>";
}

function hasConcreteRequestId(requestId: string) {
  return requestId !== "<requestId>";
}

function conversationalApprovalRequest(kind: "device" | "operator" | "node") {
  if (kind === "node") return "Hey Claw, approve remaining Even G2 node tools.";
  if (kind === "operator") return "Hey Claw, approve remaining Even G2 operator requests.";
  return "Hey Claw, approve my pending Even G2 setup.";
}

function conversationalSetupRequest() {
  return "Hey Claw, show my Even G2 setup QR.";
}

function openClawAskBody(request: string) {
  return ["Ask OpenClaw with:", `"${request}"`].join("\n");
}

function hostCommand(approveCommand: string, discoveryCommand: string, requestId: string, askPhrase: string) {
  const approveLine = hasConcreteRequestId(requestId)
    ? `\`$ ${approveCommand} ${requestId}\``
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

export function nodeApprovalGuidance(requestId = "<requestId>"): ConnectionGuidance {
  return {
    title: "Node approval required",
    body: "The device and operator are trusted. Approve the node command request so OpenClaw can use Even G2 tools like canvas and push-to-talk.",
    action: hostCommand("openclaw nodes approve", "openclaw nodes pending", requestId, conversationalApprovalRequest("node")),
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

export function guidanceForConnectionState(statusText: string, hasSetupCode: boolean): ConnectionGuidance | null {
  const normalized = statusText.toLowerCase();
  const requestId = requestIdFrom(statusText);
  if (!hasSetupCode || normalized.includes("setup code is empty")) {
    return setupConnectionGuidance();
  }
  if (normalized.includes("higher role") || normalized.includes("role-upgrade")) {
    return operatorApprovalGuidance(requestId);
  }
  if (normalized.includes("node") && (normalized.includes("approval") || normalized.includes("not approved") || normalized.includes("unapproved"))) {
    return nodeApprovalGuidance(requestId);
  }
  if (normalized.includes("origin not allowed") || normalized.includes("allowedorigins")) {
    return originBlockGuidance();
  }
  if (normalized.includes("not approved yet") || normalized.includes("pairing required")) {
    return deviceApprovalGuidance(requestId);
  }
  if (normalized.includes("websocket") || normalized.includes("network") || normalized.includes("connection error")) {
    return {
      title: "Gateway connection blocked",
      body: "The setup code was accepted, but the WebSocket connection did not complete.",
      action: "Check Even Hub network whitelist, OpenClaw allowedOrigins, and that the Gateway URL is reachable from this phone.",
    };
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
      reconnectReason: "needs attention",
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
