import { describe, expect, it } from "vitest";
import { setupOpenClawAskRequest } from "../src/openclaw-ask-requests.ts";
import {
  agentOnboardingVerdict,
  extractAgentResponseText,
  parseAgentJsonOutput,
  parseArgs,
} from "./e2e-agent-onboarding-smoke.ts";

const okCommand = {
  args: ["openclaw", "agent"],
  exitCode: 0,
  json: [],
  ok: true,
  stderr: "",
  stdout: "",
  timedOut: false,
};

describe("e2e onboarding agent smoke helpers", () => {
  it("uses the app's actual setup Ask OpenClaw request by default", () => {
    const args = parseArgs([], new Date("2026-06-30T01:02:03.000Z"));

    expect(args.message).toBe(setupOpenClawAskRequest());
    expect(args.message).toContain("show my Even G2 setup QR");
    expect(args.sessionKey).toBe("agent:main:eveng2-onboarding-smoke-2026-06-30T01-02-03-000Z");
  });

  it("adds the host-reachable Gateway URL to isolated onboarding prompts", () => {
    const args = parseArgs(["--gateway-url", "ws://127.0.0.1:19002"], new Date("2026-06-30T01:02:03.000Z"));

    expect(args.gatewayUrl).toBe("ws://127.0.0.1:19002");
    expect(args.message).toBe(setupOpenClawAskRequest("ws://127.0.0.1:19002"));
  });

  it("extracts assistant text from structured OpenClaw Agent JSON", () => {
    const stdout = JSON.stringify({
      events: [
        { role: "user", content: "Hey Claw, show my Even G2 setup QR." },
        {
          role: "assistant",
          content: "Run openclaw qr to show the Even G2 setup QR, then scan the setup code from the phone.",
        },
      ],
    });

    expect(parseAgentJsonOutput(stdout)).toHaveLength(1);
    expect(extractAgentResponseText(stdout)).toBe(
      "Run openclaw qr to show the Even G2 setup QR, then scan the setup code from the phone.",
    );
  });

  it("prefers OpenClaw Agent payload text over lifecycle summaries", () => {
    const stdout = JSON.stringify({
      status: "ok",
      summary: "completed",
      result: {
        payloads: [
          {
            text: "Displayed the Even G2 setup QR. Scan it from the OpenClaw Node setup screen.",
          },
        ],
        meta: {
          finalAssistantVisibleText: "Displayed the Even G2 setup QR. Scan it from the OpenClaw Node setup screen.",
        },
      },
    });

    expect(extractAgentResponseText(stdout)).toBe(
      "Displayed the Even G2 setup QR. Scan it from the OpenClaw Node setup screen.",
    );
  });

  it("passes when the Agent response contains actionable Even G2 setup QR guidance", () => {
    const response = "OpenClaw can show the Even G2 setup QR with openclaw qr. Scan the setup code from the phone.";

    expect(agentOnboardingVerdict({ ...okCommand, stdout: response }, response)).toMatchObject({
      ok: true,
    });
  });

  it("rejects generic or prompt-only output", () => {
    const generic = "I can help with that.";
    const promptOnly = JSON.stringify({
      role: "user",
      content: setupOpenClawAskRequest(),
    });
    const rawPromptEcho = `prompt: ${setupOpenClawAskRequest()}`;

    expect(agentOnboardingVerdict({ ...okCommand, stdout: generic }, generic).ok).toBe(false);
    expect(extractAgentResponseText(promptOnly)).toBe("");
    expect(agentOnboardingVerdict({ ...okCommand, stdout: promptOnly }, extractAgentResponseText(promptOnly)).ok).toBe(false);
    expect(extractAgentResponseText(rawPromptEcho)).toBe(rawPromptEcho);
    expect(agentOnboardingVerdict({ ...okCommand, stdout: rawPromptEcho }, extractAgentResponseText(rawPromptEcho)).ok).toBe(false);
  });

  it("requires isolated Agent responses to preserve the host Gateway URL", () => {
    const gatewayUrl = "ws://127.0.0.1:19002";
    const response = "OpenClaw displayed the Even G2 setup QR for ws://127.0.0.1:19002. Scan the setup code from the phone.";
    const bridgeResponse = "OpenClaw displayed the Even G2 setup QR for ws://172.17.0.2:19001. Scan the setup code from the phone.";

    expect(agentOnboardingVerdict({ ...okCommand, stdout: response }, response, {
      gatewayUrl,
      promptText: setupOpenClawAskRequest(gatewayUrl),
    }).ok).toBe(true);
    expect(agentOnboardingVerdict({ ...okCommand, stdout: bridgeResponse }, bridgeResponse, {
      gatewayUrl,
      promptText: setupOpenClawAskRequest(gatewayUrl),
    }).ok).toBe(false);
  });

  it("rejects onboarding responses that drop a required Gateway path or query", () => {
    const gatewayUrl = "wss://gateway.example.test/openclaw/ws?tenant=alpha";
    const fullResponse = "OpenClaw displayed the Even G2 setup QR for wss://gateway.example.test/openclaw/ws?tenant=alpha. Scan the setup code from the phone.";
    const hostOnlyResponse = "OpenClaw displayed the Even G2 setup QR for wss://gateway.example.test. Scan the setup code from the phone.";

    expect(agentOnboardingVerdict({ ...okCommand, stdout: fullResponse }, fullResponse, {
      gatewayUrl,
      promptText: setupOpenClawAskRequest(gatewayUrl),
    }).ok).toBe(true);
    expect(agentOnboardingVerdict({ ...okCommand, stdout: hostOnlyResponse }, hostOnlyResponse, {
      gatewayUrl,
      promptText: setupOpenClawAskRequest(gatewayUrl),
    }).ok).toBe(false);
  });

  it("accepts root-path Gateway query URLs without forcing a slash before the query", () => {
    const gatewayUrl = "wss://gateway.example.test?tenant=alpha";
    const response = "OpenClaw displayed the Even G2 setup QR for wss://gateway.example.test?tenant=alpha. Scan the setup code from the phone.";

    expect(agentOnboardingVerdict({ ...okCommand, stdout: response }, response, {
      gatewayUrl,
      promptText: setupOpenClawAskRequest(gatewayUrl),
    }).ok).toBe(true);
  });

  it("compares Gateway URL path and query case-sensitively while allowing host case differences", () => {
    const gatewayUrl = "wss://gateway.example.test/OpenClaw/ws?tenant=Alpha";
    const hostCaseResponse = "OpenClaw displayed the Even G2 setup QR for WSS://GATEWAY.EXAMPLE.TEST/OpenClaw/ws?tenant=Alpha. Scan the setup code from the phone.";
    const pathCaseResponse = "OpenClaw displayed the Even G2 setup QR for wss://gateway.example.test/openclaw/ws?tenant=alpha. Scan the setup code from the phone.";

    expect(agentOnboardingVerdict({ ...okCommand, stdout: hostCaseResponse }, hostCaseResponse, {
      gatewayUrl,
      promptText: setupOpenClawAskRequest(gatewayUrl),
    }).ok).toBe(true);
    expect(agentOnboardingVerdict({ ...okCommand, stdout: pathCaseResponse }, pathCaseResponse, {
      gatewayUrl,
      promptText: setupOpenClawAskRequest(gatewayUrl),
    }).ok).toBe(false);
  });

  it("redacts secret-bearing Gateway URLs in onboarding check details", () => {
    const gatewayUrl = "wss://gateway.example.test/openclaw?token=secret-token";
    const response = "OpenClaw displayed the Even G2 setup QR for wss://gateway.example.test/openclaw. Scan the setup code from the phone.";

    const verdict = agentOnboardingVerdict({ ...okCommand, stdout: response }, response, {
      gatewayUrl,
      promptText: setupOpenClawAskRequest(gatewayUrl),
    });
    const detail = verdict.checks.find((check) => check.name === "host-gateway-url")?.detail || "";

    expect(detail).toContain("token=<redacted>");
    expect(detail).not.toContain("secret-token");
  });

  it("accepts redacted secret-bearing Gateway URLs when checking preservation", () => {
    const gatewayUrl = "wss://user:secret-pass@gateway.example.test/OpenClaw/ws?token=secret-token";
    const response = "OpenClaw displayed the Even G2 setup QR for wss://user:<redacted>@gateway.example.test/OpenClaw/ws?token=<redacted>. Scan the setup code from the phone.";

    expect(agentOnboardingVerdict({ ...okCommand, stdout: response }, response, {
      gatewayUrl,
      promptText: setupOpenClawAskRequest(gatewayUrl),
    }).ok).toBe(true);
  });

  it("allows the requested 172.x Gateway URL while rejecting other bridge URLs", () => {
    const gatewayUrl = "ws://172.20.3.4:19002/openclaw/ws";
    const response = "OpenClaw displayed the Even G2 setup QR for ws://172.20.3.4:19002/openclaw/ws. Scan the setup code from the phone.";
    const bridgeResponse = "OpenClaw displayed the Even G2 setup QR for ws://172.20.3.4:19002/openclaw/ws, not ws://172.17.0.2:19001. Scan the setup code from the phone.";

    expect(agentOnboardingVerdict({ ...okCommand, stdout: response }, response, {
      gatewayUrl,
      promptText: setupOpenClawAskRequest(gatewayUrl),
    }).ok).toBe(true);
    expect(agentOnboardingVerdict({ ...okCommand, stdout: bridgeResponse }, bridgeResponse, {
      gatewayUrl,
      promptText: setupOpenClawAskRequest(gatewayUrl),
    }).ok).toBe(false);
  });
});
