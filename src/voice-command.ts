export const NODE_PTT_DEFAULT_DURATION_MS = 8000;
export const NODE_PTT_MIN_DURATION_MS = 1000;
export const NODE_PTT_MAX_DURATION_MS = 30000;
export const NODE_PTT_TIMEOUT_RESERVE_MS = 3000;

export type TalkPttNodeCommandPlan = {
  action: "start-voice";
  requiresBridge: true;
  durationMs: number;
};

export function nodePttDurationMs(params: Record<string, unknown> | undefined, timeoutMs: unknown) {
  const requestedDuration = typeof params?.durationMs === "number" && Number.isFinite(params.durationMs)
    ? params.durationMs
    : typeof timeoutMs === "number" && Number.isFinite(timeoutMs)
      ? timeoutMs - NODE_PTT_TIMEOUT_RESERVE_MS
      : NODE_PTT_DEFAULT_DURATION_MS;
  return Math.min(
    NODE_PTT_MAX_DURATION_MS,
    Math.max(NODE_PTT_MIN_DURATION_MS, Math.floor(requestedDuration)),
  );
}

export function talkPttNodeCommandPlan(
  command: string,
  params: Record<string, unknown> | undefined,
  timeoutMs: unknown,
): TalkPttNodeCommandPlan | null {
  if (command !== "talk.ptt.once") return null;
  return {
    action: "start-voice",
    requiresBridge: true,
    durationMs: nodePttDurationMs(params, timeoutMs),
  };
}

export function nodeVoiceCloseCommandResult(transcriptText: string) {
  const text = transcriptText.trim();
  if (text) return { ok: true as const, payload: { text } };
  return {
    ok: false as const,
    payload: {},
    error: {
      code: "VOICE_CLOSED",
      message: "Voice capture closed before a transcript was produced.",
    },
  };
}
