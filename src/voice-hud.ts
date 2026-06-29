import { glassHudFrameToText, glassStatusFrame, shortText } from "./glass";
import type { GlassHudFrame } from "./glass";
import { voiceFailureKind, voiceModeGatewayGuidance } from "./voice-settings";
import type { VoiceMode } from "./voice-settings";

export type VoiceDraftPendingPhase = "preprocess" | "upload" | "draft";
export type VoiceCaptureMode = "review" | "direct";

export function voiceFailureHudFrame(errorText: string): GlassHudFrame {
  const reason = shortText(errorText.replace(/^error:\s*/i, "").trim(), 120);
  const kind = voiceFailureKind(errorText);
  if (kind === "voice-setup") {
    return glassStatusFrame("Voice setup needed", reason, "check OpenClaw voice setup");
  }
  if (kind === "microphone") {
    return glassStatusFrame("Microphone unavailable", reason, "check Even Hub permissions");
  }
  if (kind === "gateway") {
    return glassStatusFrame("OpenClaw disconnected", reason, "reconnect, then try again");
  }
  return glassStatusFrame("Voice failed", reason, "try again");
}

export function voiceFailureStatus(errorText: string) {
  const kind = voiceFailureKind(errorText);
  if (kind === "voice-setup") return "voice setup needs attention";
  if (kind === "microphone") return "microphone unavailable";
  if (kind === "gateway") return "OpenClaw disconnected";
  return "voice failed";
}

export function voiceNoSpeechHudFrame(): GlassHudFrame {
  return glassStatusFrame("No speech detected", "OpenClaw did not receive usable speech.", "try again");
}

export function voiceInputOffHudFrame(): GlassHudFrame {
  return glassStatusFrame("Voice input is off", "Change Voice input mode on the phone.", "phone settings");
}

export function voiceSetupNeededHudFrame(detail: string): GlassHudFrame {
  return glassStatusFrame("Voice setup needed", shortText(detail, 180), "check OpenClaw voice setup");
}

export function voiceSetupStepHudFrame(mode: VoiceMode): GlassHudFrame {
  const setupMode = mode === "off" ? "review" : mode;
  return glassStatusFrame(
    "Step 4/4: Voice setup",
    [
      "Send this to your OpenClaw chat:",
      "",
      voiceModeGatewayGuidance(setupMode).request || "Set up OpenClaw Even G2 Review voice.",
      "",
      "Then return here.",
    ].join("\n"),
    "tap when done",
  );
}

export function voiceDisconnectedNotSentHudFrame(): GlassHudFrame {
  return glassStatusFrame("OpenClaw disconnected", "Voice was not sent.", "reconnect, then try again");
}

export function standaloneVoiceTranscriptHudFrame(text: string): GlassHudFrame {
  return glassStatusFrame("Voice transcript", shortText(text, 220), "tap speak");
}

export function recordingPulseHeader(mode: VoiceCaptureMode, activeSessionLabel: string, pulseIndex: number) {
  const pulse = ["Recording   ", "Recording.  ", "Recording.. ", "Recording..."][pulseIndex % 4] || "Recording...";
  const label = shortText(activeSessionLabel, 12);
  return `${pulse} · ${label} · ${mode === "direct" ? "send" : "review"}`;
}

export function recordingPlaceholder() {
  return "";
}

export function voiceDraftPendingCopy(phase: VoiceDraftPendingPhase) {
  if (phase === "upload") {
    return {
      stepTitle: "2/3 Sending audio",
      detail: "Sending audio to OpenClaw.",
    };
  }
  if (phase === "draft") {
    return {
      stepTitle: "Finalizing transcript",
      detail: "OpenClaw is finishing the live dictation text.",
    };
  }
  return {
    stepTitle: "1/3 Preparing audio",
    detail: "Trimming silence, checking speech, and reducing obvious noise.",
  };
}

export function voicePanelPreviewText(base: GlassHudFrame, title: string, body: string, hint: string) {
  return [
    glassHudFrameToText(base),
    "",
    `--- ${title} ---`,
    body,
    hint,
  ].filter(Boolean).join("\n");
}
