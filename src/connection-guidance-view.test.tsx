import { describe, expect, it } from "vitest";
import { connectionGuidanceActionParts } from "./connection-guidance-view";

describe("connectionGuidanceActionParts", () => {
  it("splits OpenClaw ask text from host details", () => {
    expect(connectionGuidanceActionParts([
      "Run on OpenClaw host:",
      "`$ openclaw qr`",
      "Or ask OpenClaw:",
      "\"Hey Claw, show setup QR.\"",
    ].join("\n"))).toEqual({
      ask: "Hey Claw, show setup QR.",
      host: "$ openclaw qr",
    });
  });
});
