import { isUserSelectableSession } from "./glass";
import type { OpenClawSession } from "./glass";

export const FALLBACK_MAIN_SESSION_KEY = "agent:main:main";
export const FALLBACK_MAIN_SESSION: OpenClawSession = {
  key: FALLBACK_MAIN_SESSION_KEY,
  preview: "OpenClaw main session",
};

export function currentDisplaySessions(sessions: OpenClawSession[]) {
  return sessions.length ? sessions : [FALLBACK_MAIN_SESSION];
}

export function filterDisplaySessions(rawSessions: OpenClawSession[]) {
  return rawSessions.filter(isUserSelectableSession);
}

export function validGatewaySessions(value: unknown): OpenClawSession[] {
  if (!Array.isArray(value)) return [];
  return value.filter((session): session is OpenClawSession => (
    typeof session?.key === "string" && session.key.length > 0
  ));
}

export function isMainSessionKey(key: string) {
  return /^agent:[^:]+:main$/i.test(key);
}

export function selectExistingSessionKey(rawSessions: OpenClawSession[], preferredKey = "") {
  if (preferredKey && rawSessions.some((session) => session.key === preferredKey)) return preferredKey;
  const filteredSessions = filterDisplaySessions(rawSessions);
  return filteredSessions.find((session) => isMainSessionKey(session.key))?.key
    || rawSessions.find((session) => isMainSessionKey(session.key))?.key
    || filteredSessions[0]?.key
    || rawSessions[0]?.key
    || "";
}

export function gatewaySessionListUpdate(value: unknown, currentSessionKey: string) {
  const sessions = validGatewaySessions(value);
  const activeSessionKey = sessions.length ? selectExistingSessionKey(sessions, currentSessionKey) : "";
  const changed = Boolean(activeSessionKey && activeSessionKey !== currentSessionKey);
  return {
    sessions,
    activeSessionKey,
    changed,
    shouldSwitchSession: changed,
    shouldRequestTranscript: changed,
    shouldResetTranscript: changed,
  };
}

export function fallbackSession(key: string): OpenClawSession {
  const fallbackKey = key || FALLBACK_MAIN_SESSION_KEY;
  return { key: fallbackKey };
}

export function sessionSelectOptions(sessions: OpenClawSession[], activeSessionKey: string) {
  const seen = new Set<string>();
  const options: OpenClawSession[] = [];
  if (activeSessionKey && !sessions.some((session) => session.key === activeSessionKey)) {
    options.push(fallbackSession(activeSessionKey));
    seen.add(activeSessionKey);
  }
  for (const session of sessions) {
    if (!session.key || seen.has(session.key)) continue;
    options.push(session);
    seen.add(session.key);
  }
  return options;
}
