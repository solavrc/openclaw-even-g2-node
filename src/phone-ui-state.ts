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
  nodeConnected: boolean;
}) {
  if (!input.hasGatewaySetup) return "Setup required";
  return input.connected ? input.nodeConnected ? "Live" : "Connecting" : "Needs attention";
}

export function liveFacts(input: {
  connected: boolean;
  hasGatewaySetup: boolean;
  nodeConnected: boolean;
  foregroundClientCount: number;
  nodeApprovalPending: boolean;
  showCanvasTutorial: boolean;
}) {
  return [
    `Gateway ${input.connected ? "connected" : "offline"}`,
    !input.hasGatewaySetup ? "scan setup QR" : input.nodeConnected ? "Even G2 paired" : "pairing pending",
    ...(input.connected && input.nodeConnected ? [input.foregroundClientCount > 0 ? "G2 bridge live" : "G2 bridge unavailable"] : []),
    ...(input.nodeApprovalPending ? ["node tools pending"] : []),
    ...(input.showCanvasTutorial ? ["canvas tutorial"] : []),
  ];
}

export function liveActionLabel(input: {
  showSetupFlow: boolean;
  showRetryNow: boolean;
}) {
  return input.showSetupFlow ? "Scan setup QR" : input.showRetryNow ? "Retry now" : "";
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
