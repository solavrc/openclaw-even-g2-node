import { describe, expect, it } from "vitest";
import {
  gatewayApprovalResolveRequest,
  gatewayNodeCommandResultRequest,
  gatewaySessionConfigGetRequest,
  gatewaySessionListRequest,
  gatewaySessionSendRequest,
  gatewaySessionSwitchRequest,
  gatewaySessionTranscriptGetRequest,
  gatewayUtteranceFinalizeRequest,
  gatewayUtteranceStartRequest,
  sendGatewayOutboxRequest,
  sendGatewaySessionBootstrapRequests,
} from "./gateway-outbox";

describe("gateway outbox messages", () => {
  it("builds session control messages", () => {
    expect(gatewaySessionConfigGetRequest()).toEqual({ type: "eveng2.session.config.get" });
    expect(gatewaySessionListRequest()).toEqual({ type: "eveng2.session.list" });
    expect(gatewaySessionTranscriptGetRequest("agent:main:main", 160)).toEqual({
      type: "eveng2.session.transcript.get",
      sessionKey: "agent:main:main",
      limit: 160,
    });
    expect(gatewaySessionSwitchRequest("agent:main:direct")).toEqual({
      type: "eveng2.session.switch",
      sessionKey: "agent:main:direct",
    });
  });

  it("builds session send and approval messages", () => {
    expect(gatewaySessionSendRequest("session", "hello", "idem-1")).toEqual({
      type: "eveng2.session.send",
      sessionKey: "session",
      message: "hello",
      idempotencyKey: "idem-1",
    });
    expect(gatewayApprovalResolveRequest({ type: "eveng2.approval.request", id: "a", requestId: "r" }, "deny")).toEqual({
      type: "eveng2.approval.resolve",
      id: "a",
      requestId: "r",
      decision: "deny",
    });
  });

  it("builds node command result messages", () => {
    expect(gatewayNodeCommandResultRequest("cmd-1", true, { status: "ok" })).toEqual({
      type: "eveng2.node.command.result",
      id: "cmd-1",
      ok: true,
      payload: { status: "ok" },
    });
    expect(gatewayNodeCommandResultRequest("cmd-1", false, {}, { code: "NOPE", message: "Nope" })).toEqual({
      type: "eveng2.node.command.result",
      id: "cmd-1",
      ok: false,
      error: { code: "NOPE", message: "Nope" },
    });
  });

  it("builds voice utterance messages", () => {
    expect(gatewayUtteranceStartRequest({ sessionKey: "session" }, "utterance-1")).toEqual({
      type: "utterance.start",
      utteranceId: "utterance-1",
      sessionKey: "session",
    });
    expect(gatewayUtteranceFinalizeRequest()).toEqual({ type: "utterance.finalize" });
  });

  it("sends serialized outbox messages through a text transport", () => {
    const sent: string[] = [];
    sendGatewayOutboxRequest({ send: (data) => sent.push(data) }, gatewaySessionListRequest());
    expect(sent).toEqual(['{"type":"eveng2.session.list"}']);
  });

  it("sends the session bootstrap requests in protocol order", () => {
    const sent: string[] = [];
    sendGatewaySessionBootstrapRequests({ send: (data) => sent.push(data) });
    expect(sent).toEqual([
      '{"type":"eveng2.session.config.get"}',
      '{"type":"eveng2.session.list"}',
    ]);
  });
});
