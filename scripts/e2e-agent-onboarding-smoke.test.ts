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

    expect(agentOnboardingVerdict({ ...okCommand, stdout: generic }, generic).ok).toBe(false);
    expect(extractAgentResponseText(promptOnly)).toBe("");
    expect(agentOnboardingVerdict({ ...okCommand, stdout: promptOnly }, extractAgentResponseText(promptOnly)).ok).toBe(false);
  });
});
