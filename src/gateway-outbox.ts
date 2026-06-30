import type { PendingApproval } from "./gateway-messages";

export type ApprovalDecision = "allow-once" | "deny";

export function gatewaySessionConfigGetRequest() {
  return { type: "eveng2.session.config.get" as const };
}

export function gatewaySessionListRequest() {
  return { type: "eveng2.session.list" as const };
}

export function gatewaySessionTranscriptGetRequest(sessionKey: string, limit: number) {
  return { type: "eveng2.session.transcript.get" as const, sessionKey, limit };
}

export function gatewaySessionSwitchRequest(sessionKey: string) {
  return { type: "eveng2.session.switch" as const, sessionKey };
}

export function gatewaySessionSendRequest(sessionKey: string, message: string, idempotencyKey: string) {
  return { type: "eveng2.session.send" as const, sessionKey, message, idempotencyKey };
}

export function gatewayApprovalResolveRequest(approval: PendingApproval, decision: ApprovalDecision) {
  return {
    type: "eveng2.approval.resolve" as const,
    id: approval.id,
    requestId: approval.requestId,
    decision,
  };
}

export function gatewayNodeCommandResultRequest(
  id: string,
  ok: boolean,
  payload: Record<string, unknown> = {},
  error?: { code: string; message: string },
) {
  return {
    type: "eveng2.node.command.result" as const,
    id,
    ok,
    ...(ok ? { payload } : { error }),
  };
}

export function gatewayNodeApprovalRefreshRequest() {
  return { type: "eveng2.node.approval.refresh" as const };
}

export function gatewayUtteranceStartRequest(config: Record<string, unknown>, utteranceId: string) {
  return {
    type: "utterance.start" as const,
    utteranceId,
    ...config,
  };
}

export function gatewayUtteranceFinalizeRequest() {
  return { type: "utterance.finalize" as const };
}

export type GatewayOutboxRequest =
  | ReturnType<typeof gatewaySessionConfigGetRequest>
  | ReturnType<typeof gatewaySessionListRequest>
  | ReturnType<typeof gatewaySessionTranscriptGetRequest>
  | ReturnType<typeof gatewaySessionSwitchRequest>
  | ReturnType<typeof gatewaySessionSendRequest>
  | ReturnType<typeof gatewayApprovalResolveRequest>
  | ReturnType<typeof gatewayNodeCommandResultRequest>
  | ReturnType<typeof gatewayNodeApprovalRefreshRequest>
  | ReturnType<typeof gatewayUtteranceStartRequest>
  | ReturnType<typeof gatewayUtteranceFinalizeRequest>;

type GatewayOutboxTransport = {
  send(data: string): void;
};

export function sendGatewayOutboxRequest(transport: GatewayOutboxTransport, request: GatewayOutboxRequest) {
  transport.send(JSON.stringify(request));
}

export function sendGatewaySessionBootstrapRequests(transport: GatewayOutboxTransport) {
  sendGatewayOutboxRequest(transport, gatewaySessionConfigGetRequest());
  sendGatewayOutboxRequest(transport, gatewaySessionListRequest());
}
