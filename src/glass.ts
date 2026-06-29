import { cleanGlassText } from "./glass-text";

export type OpenClawSession = {
  key: string;
  preview?: string;
  label?: string;
  displayName?: string;
  groupChannel?: string;
  kind?: string;
  firstUserMessage?: string;
  lastUserMessage?: string;
  firstAgentMessage?: string;
  lastAgentMessage?: string;
  lastMessage?: string;
  updatedAt?: number;
};

export type SessionTranscriptMessage = {
  id?: string | null;
  parentId?: string | null;
  role?: string;
  text?: string;
  timestamp?: string | null;
  provider?: string | null;
  model?: string | null;
};

export type GlassHudFrame = {
  header: string;
  body: string;
  hint: string;
};

export type GlassApprovalDecision = "allow-once" | "deny";

export type GlassHudFrameInput = Partial<GlassHudFrame> & Pick<GlassHudFrame, "header">;

export function normalizeGlassHudFrame(frame: GlassHudFrameInput): GlassHudFrame {
  return {
    header: cleanHudText(frame.header || "OpenClaw Node"),
    body: cleanHudText(frame.body || ""),
    hint: cleanHudText(frame.hint || ""),
  };
}

export function glassHudFrameToText(frame: GlassHudFrameInput) {
  const normalized = normalizeGlassHudFrame(frame);
  return [
    normalized.header,
    ...(normalized.body ? ["", normalized.body] : []),
    ...(normalized.hint ? ["", normalized.hint] : []),
  ].join("\n");
}

export function glassStatusFrame(header: string, body = "", hint = ""): GlassHudFrame {
  return normalizeGlassHudFrame({ header, body, hint });
}

function cleanHudText(text: string) {
  return cleanGlassText(text);
}

export function shortText(text: string, max = 72) {
  const clean = cleanGlassText(text).replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, Math.max(0, max - 3))}...` : clean;
}

export function middleText(text: string, max = 72) {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const side = Math.max(2, Math.floor((max - 3) / 2));
  return `${clean.slice(0, side)}...${clean.slice(-side)}`;
}

function isAgentMainSessionKey(key: string) {
  return /^agent:[^:]+:main$/i.test(key);
}

export function labelForSession(session: OpenClawSession) {
  const label = isAgentMainSessionKey(session.key)
    ? "main"
    : sessionIdentityText(session);
  return label.length > 80 ? `${label.slice(0, 77)}...` : label;
}

function informativeSessionText(value: string | undefined) {
  const text = (value || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  if (/^(direct|dashboard|group|thread)$/i.test(text)) return "";
  if (/^(even g2|openclaw node)$/i.test(text)) return "";
  if (/^untitled session(?: #\d+)?$/i.test(text)) return "";
  if (/^\[System\]/i.test(text)) return "";
  if (/^\[User sent media without caption\]$/i.test(text)) return "";
  if (/^agent:[\w:-]+$/i.test(text)) return "";
  if (/^[a-z]-[a-z0-9_-]{12,}$/i.test(text)) return "";
  if (/^discord:[a-z]-[a-z0-9_-]{12,}$/i.test(text)) return "";
  if (/^discord:\d+#/i.test(text)) return "";
  return text;
}

function formattedSessionUpdatedAt(updatedAt: number | undefined) {
  if (typeof updatedAt !== "number" || !Number.isFinite(updatedAt) || updatedAt <= 0) return "";
  const date = new Date(updatedAt);
  if (Number.isNaN(date.getTime())) return "";
  const month = String(date.getMonth() + 1);
  const day = String(date.getDate());
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  return `${month}/${day} ${hour}:${minute}`;
}

function fallbackSessionLabel(session: OpenClawSession) {
  const updatedAt = formattedSessionUpdatedAt(session.updatedAt);
  return updatedAt ? `Recent session ${updatedAt}` : "Recent session";
}

function sessionIdentityText(session: OpenClawSession) {
  return informativeSessionText(session.firstUserMessage)
    || informativeSessionText(session.lastUserMessage)
    || informativeSessionText(session.firstAgentMessage)
    || informativeSessionText(session.lastAgentMessage)
    || informativeSessionText(session.lastMessage)
    || informativeSessionText(session.preview)
    || informativeSessionText(session.label)
    || informativeSessionText(session.groupChannel)
    || informativeSessionText(session.displayName)
    || informativeSessionText(session.kind)
    || fallbackSessionLabel(session);
}

export function isUserSelectableSession(session: OpenClawSession) {
  if (isAgentMainSessionKey(session.key)) return true;
  if (/^agent:[^:]+:cron:/i.test(session.key)) return false;
  if (/^agent:[^:]+:subagent:/i.test(session.key)) return false;
  if (/^agent:[^:]+:explicit:model-run-/i.test(session.key)) return false;
  if (/^agent:[^:]+:node-/i.test(session.key)) return false;
  if (/^agent:[^:]+:eveng2:/i.test(session.key)) return false;
  if (/^cron$/i.test(session.kind || "")) return false;
  const label = informativeSessionText(session.firstUserMessage)
    || informativeSessionText(session.lastUserMessage)
    || informativeSessionText(session.firstAgentMessage)
    || informativeSessionText(session.lastAgentMessage)
    || informativeSessionText(session.lastMessage)
    || informativeSessionText(session.preview)
    || informativeSessionText(session.label)
    || informativeSessionText(session.groupChannel)
    || informativeSessionText(session.displayName)
    || informativeSessionText(session.kind);
  if (/^cron:/i.test(label)) return false;
  return true;
}

const SESSION_SCREEN_TARGET_BYTES = 420;
const UTF8_ENCODER = new TextEncoder();
const SESSION_MENU_HINT = "tap speak";
const SESSION_PAGE_HINT = "▲▼ page · tap speak";

export function isUserVisibleTranscriptMessage(message: SessionTranscriptMessage) {
  const role = (message.role || "").toLowerCase();
  return (role === "user" || role === "assistant")
    && typeof message.text === "string"
    && message.text.trim().length > 0;
}

export function wrapGlassSessionText(text: string) {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((paragraph) => paragraph.replace(/[ \t]+/g, " ").trim())
    .filter((paragraph, index, paragraphs) => paragraph || index === 0 || index === paragraphs.length - 1);
}

function normalizedTranscriptText(text: string) {
  return cleanGlassText(text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim());
}

function utf8ByteLength(text: string) {
  return UTF8_ENCODER.encode(text).length;
}

function maxUtf8PrefixIndex(text: string, maxBytes: number) {
  let low = 0;
  let high = text.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (utf8ByteLength(text.slice(0, mid)) <= maxBytes) low = mid;
    else high = mid - 1;
  }
  return Math.max(1, low);
}

function turnRoleHeader(role: string | undefined) {
  const normalized = (role || "").toLowerCase();
  if (normalized === "user") return "user";
  if (normalized === "assistant") return "agent";
  return "message";
}

function sessionScreenHeader(activeSessionLabel: string, role: string | undefined, pageIndex = 0, pageCount = 1) {
  const pageLabel = ` · ${pageIndex + 1}/${Math.max(1, pageCount)}`;
  return `${shortText(activeSessionLabel, 18)} · ${turnRoleHeader(role)}${pageLabel}`;
}

function screenFrame(header: string, body: string, hint = SESSION_MENU_HINT): GlassHudFrame {
  return glassStatusFrame(header, body, hint);
}

function splitBodyByBytes(body: string, headerBytes: number, maxBytes = SESSION_SCREEN_TARGET_BYTES) {
  const chunks: string[] = [];
  let remaining = body.trim();
  const maxBodyBytes = Math.max(1, maxBytes - headerBytes);
  while (remaining && utf8ByteLength(remaining) > maxBodyBytes) {
    const hardLimit = maxUtf8PrefixIndex(remaining, maxBodyBytes);
    const candidate = remaining.slice(0, hardLimit);
    const paragraphBreak = candidate.lastIndexOf("\n\n");
    const sentenceBreak = Math.max(candidate.lastIndexOf("。"), candidate.lastIndexOf(". "));
    const whitespaceBreak = candidate.lastIndexOf(" ");
    const minimumUsefulBytes = Math.floor(maxBodyBytes * 0.45);
    const breakAt = [paragraphBreak > 0 ? paragraphBreak : -1, sentenceBreak > 0 ? sentenceBreak + 1 : -1, whitespaceBreak > 0 ? whitespaceBreak : -1]
      .find((index) => index > 0 && utf8ByteLength(candidate.slice(0, index)) >= minimumUsefulBytes) ?? hardLimit;
    chunks.push(remaining.slice(0, breakAt).trim());
    remaining = remaining.slice(breakAt).trim();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

export function sessionTranscriptDisplayFrames(messages: SessionTranscriptMessage[], activeSessionLabel = "main") {
  const screens: GlassHudFrame[] = [];
  for (const message of messages.filter(isUserVisibleTranscriptMessage)) {
    const body = wrapGlassSessionText(normalizedTranscriptText(message.text || "")).join("\n");
    const chunks = splitBodyByBytes(body, utf8ByteLength(`${sessionScreenHeader(activeSessionLabel, message.role, 998, 999)}\n\n\n\n${SESSION_PAGE_HINT}`));
    chunks.forEach((chunk, index) => {
      const header = sessionScreenHeader(activeSessionLabel, message.role, index, chunks.length);
      screens.push(screenFrame(header, chunk, chunks.length > 1 ? SESSION_PAGE_HINT : SESSION_MENU_HINT));
    });
  }
  return screens;
}

export function sessionTranscriptDisplayScreens(messages: SessionTranscriptMessage[], activeSessionLabel = "main") {
  return sessionTranscriptDisplayFrames(messages, activeSessionLabel).map(glassHudFrameToText);
}

export function formatGlassSessionViewFrame({
  activeSessionLabel,
  messages,
  statusText,
  logCursor = 0,
}: {
  activeSessionLabel: string;
  messages: SessionTranscriptMessage[];
  statusText: string;
  logCursor?: number;
}) {
  const screens = sessionTranscriptDisplayFrames(messages, activeSessionLabel);
  const maxCursor = Math.max(0, screens.length - 1);
  const safeCursor = Math.max(0, Math.min(maxCursor, Math.floor(logCursor)));
  const screenIndex = Math.max(0, screens.length - 1 - safeCursor);
  if (screens.length) return screens[screenIndex];
  if (statusText === "loading earlier log") return screenFrame(`${shortText(activeSessionLabel, 18)} · loading`, "Loading earlier log");
  if (statusText === "loading session log") return screenFrame(`${shortText(activeSessionLabel, 18)} · loading`, "Loading session log");
  if (statusText === "voice submitted to OpenClaw") return screenFrame(`${shortText(activeSessionLabel, 18)} · sent`, "Sent to OpenClaw");
  return screenFrame(`${shortText(activeSessionLabel, 18)} · ready`, "No session text yet.");
}

export function formatGlassSessionView(options: Parameters<typeof formatGlassSessionViewFrame>[0]) {
  return glassHudFrameToText(formatGlassSessionViewFrame(options));
}

export function formatGlassSessionCreateFailedFrame(errorText: string): GlassHudFrame {
  return glassStatusFrame("Session not created", shortText(errorText, 180), "check phone");
}

export function formatGlassApprovalViewFrame({
  command,
  ask,
  cwd,
}: {
  command?: string | null;
  ask?: string | null;
  cwd?: string | null;
}) {
  const request = shortText(command || ask || "OpenClaw request", 96);
  const detail = cwd ? `cwd ${shortText(cwd, 56)}` : "approval required";
  return glassStatusFrame("■ APPROVAL · main", [request, detail].filter(Boolean).join("\n"), "tap allow · 2-tap deny");
}

export function formatGlassApprovalView(options: Parameters<typeof formatGlassApprovalViewFrame>[0]) {
  return glassHudFrameToText(formatGlassApprovalViewFrame(options));
}

export function formatGlassApprovalDecisionFrame(decision: GlassApprovalDecision): GlassHudFrame {
  return glassStatusFrame(
    decision === "allow-once" ? "Approved" : "Rejected",
    "Waiting for OpenClaw.",
    "wait...",
  );
}

export function formatGlassListeningViewFrame({
  activeSessionLabel,
  transcript,
  voiceMode = "review",
  recordingPulse = 0,
}: {
  activeSessionLabel: string;
  transcript?: string;
  voiceMode?: "review" | "direct";
  recordingPulse?: number;
}) {
  const rec = ["Recording   ", "Recording.  ", "Recording.. ", "Recording..."][recordingPulse % 4] || "Recording...";
  const header = `${rec} · ${shortText(activeSessionLabel, 12)} · ${voiceMode === "direct" ? "send" : "review"}`;
  if (voiceMode === "direct") {
    return glassStatusFrame(
      header,
      ["[ Send now ]", shortText(transcript?.trim() || "", 172)].filter(Boolean).join("\n"),
      "tap send · 2-tap cancel",
    );
  }
  return glassStatusFrame(
    header,
    shortText(transcript?.trim() || "", 220),
    "tap stop · 2-tap cancel",
  );
}

export function formatGlassListeningView(options: Parameters<typeof formatGlassListeningViewFrame>[0]) {
  return glassHudFrameToText(formatGlassListeningViewFrame(options));
}

export function formatGlassVoiceDraftViewFrame({
  activeSessionLabel,
  text,
}: {
  activeSessionLabel: string;
  text: string;
}) {
  return glassStatusFrame(
    `${shortText(activeSessionLabel, 18)} · ready`,
    shortText(text.trim() || "No speech detected", 220),
    "tap send · 2-tap discard",
  );
}

export function formatGlassVoiceDraftView(options: Parameters<typeof formatGlassVoiceDraftViewFrame>[0]) {
  return glassHudFrameToText(formatGlassVoiceDraftViewFrame(options));
}

export function formatGlassVoiceDraftPendingViewFrame({
  activeSessionLabel,
  stepTitle = "Preparing transcript",
  detail = "OpenClaw is transcribing and cleaning up your voice.",
}: {
  activeSessionLabel: string;
  stepTitle?: string;
  detail?: string;
}) {
  return glassStatusFrame(
    `${shortText(activeSessionLabel, 18)} · ready`,
    [shortText(stepTitle, 48), shortText(detail, 160)].join("\n"),
    "wait...",
  );
}

export function formatGlassVoiceDraftPendingView(options: Parameters<typeof formatGlassVoiceDraftPendingViewFrame>[0]) {
  return glassHudFrameToText(formatGlassVoiceDraftPendingViewFrame(options));
}
