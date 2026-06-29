export function closeReasonFromEvent(event: Event) {
  const reason = (event as Partial<CloseEvent>).reason;
  return typeof reason === "string" ? reason.trim() : "";
}

export function gatewayCloseStatus(reason: string, currentStatus: string) {
  if (reason) return `error: ${reason}`;
  if (currentStatus.startsWith("error:") || currentStatus === "connection error") return currentStatus;
  return "disconnected";
}

export function gatewayErrorStatus(currentStatus: string) {
  return currentStatus.startsWith("error:") ? currentStatus : "connection error";
}

export function nodeApprovalRequiredStatus(requestId: string | undefined) {
  return requestId
    ? `node approval required (requestId: ${requestId})`
    : "node approval required";
}

export function shouldRestoreReadyAfterNodeApproval(status: string) {
  return status === "node approval required" || status.startsWith("node approval required ");
}

export function shouldCloseGatewayTransport(readyState: number, closingState: number) {
  return readyState < closingState;
}

export function isGatewayTransportOpen(readyState: number | undefined, openState: number) {
  return readyState === openState;
}

export function canSendGatewayNodeCommandResult(input: {
  readyState?: number;
  openState: number;
  canSendOverride?: boolean;
}) {
  return isGatewayTransportOpen(input.readyState, input.openState) || input.canSendOverride === true;
}
