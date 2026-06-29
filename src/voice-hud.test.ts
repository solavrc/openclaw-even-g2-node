import { describe, expect, it } from "vitest";
import {
  recordingPulseHeader,
  standaloneVoiceTranscriptHudFrame,
  voiceDisconnectedNotSentHudFrame,
  voiceDraftPendingCopy,
  voiceFailureHudFrame,
  voiceFailureStatus,
  voiceInputOffHudFrame,
  voiceNoSpeechHudFrame,
  voicePanelPreviewText,
  voiceSetupNeededHudFrame,
  voiceSetupStepHudFrame,
} from "./voice-hud";

describe("voice HUD helpers", () => {
  it("formats recording headers for review and send-now modes", () => {
    expect(recordingPulseHeader("review", "agent:main:main", 2)).toBe("Recording..  · agent:mai... · review");
    expect(recordingPulseHeader("direct", "main", 3)).toBe("Recording... · main · send");
  });

  it("describes pending draft phases", () => {
    expect(voiceDraftPendingCopy("preprocess").stepTitle).toBe("1/3 Preparing audio");
    expect(voiceDraftPendingCopy("upload").stepTitle).toBe("2/3 Sending audio");
    expect(voiceDraftPendingCopy("draft").stepTitle).toBe("Finalizing transcript");
  });

  it("maps failures to glasses HUD frames and status text", () => {
    expect(voiceFailureStatus("gateway session is not open")).toBe("OpenClaw disconnected");
    expect(voiceFailureHudFrame("microphone blocked")).toEqual({
      header: "Microphone unavailable",
      body: "microphone blocked",
      hint: "check Even Hub permissions",
    });
  });

  it("builds a no-speech HUD frame", () => {
    expect(voiceNoSpeechHudFrame()).toEqual({
      header: "No speech detected",
      body: "OpenClaw did not receive usable speech.",
      hint: "try again",
    });
  });

  it("builds voice setup and disabled HUD frames", () => {
    expect(voiceInputOffHudFrame()).toEqual({
      header: "Voice input is off",
      body: "Change Voice input mode on the phone.",
      hint: "phone settings",
    });
    const setupFrame = voiceSetupNeededHudFrame("provider configuration needs attention".repeat(10));
    expect(setupFrame).toMatchObject({
      header: "Voice setup needed",
      hint: "check OpenClaw voice setup",
    });
    expect(setupFrame.body).toHaveLength(180);
    expect(setupFrame.body).toMatch(/\.\.\.$/);
  });

  it("builds voice action HUD frames", () => {
    expect(voiceSetupStepHudFrame("off")).toEqual({
      header: "Step 4/4: Voice setup",
      body: [
        "Send this to your OpenClaw chat:",
        "",
        "Set up OpenClaw Even G2 Review voice. See solavrc/openclaw-even-g2-node.",
        "",
        "Then return here.",
      ].join("\n"),
      hint: "tap when done",
    });
    expect(voiceSetupStepHudFrame("direct").body).toContain("Send now voice");
    expect(voiceDisconnectedNotSentHudFrame()).toEqual({
      header: "OpenClaw disconnected",
      body: "Voice was not sent.",
      hint: "reconnect, then try again",
    });
  });

  it("bounds standalone transcript HUD text", () => {
    const frame = standaloneVoiceTranscriptHudFrame("hello ".repeat(80));
    expect(frame).toMatchObject({
      header: "Voice transcript",
      hint: "tap speak",
    });
    expect(frame.body).toHaveLength(220);
    expect(frame.body).toMatch(/\.\.\.$/);
  });

  it("builds phone preview text for voice panels", () => {
    expect(voicePanelPreviewText(
      { header: "main", body: "ready", hint: "tap" },
      "Review transcript",
      "hello",
      "tap send",
    )).toContain("--- Review transcript ---");
  });
});
