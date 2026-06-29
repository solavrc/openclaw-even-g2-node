export type PageVisibility = DocumentVisibilityState | "unknown";

export function isForegroundBridgeAvailable(hasBridge: boolean, _visibilityState: PageVisibility) {
  return hasBridge;
}

export function shouldResumeForegroundWorkForPageShow(visibilityState: PageVisibility) {
  return visibilityState !== "unknown";
}

export function foregroundResumeStatus(
  currentStatus: string,
  connected: boolean,
  voicePaused: boolean,
  reconnecting = false,
): string | null {
  if (voicePaused) return reconnecting ? "voice canceled; reconnecting" : "voice canceled";
  if (connected && currentStatus === "backgrounded") return "ready";
  if (reconnecting) return "resuming";
  return null;
}

export function foregroundHadActiveVoice(input: {
  voiceCaptureActive: boolean;
  glassView: string;
}) {
  return input.voiceCaptureActive || input.glassView === "listening" || input.glassView === "voiceDraftPending";
}

export function shouldReconnectOnForegroundResume(input: {
  gatewayUrl: string;
  connected: boolean;
}) {
  return Boolean(input.gatewayUrl.trim() && !input.connected);
}

export type EvenHubLifecycleAction = "foregroundEnter" | "foregroundExit" | "abnormalExit" | "systemExit";
export const DEFAULT_LIFECYCLE_DEDUPE_WINDOW_MS = 600;

type EvenHubLifecycleEventLike = {
  sysEvent?: { eventType?: unknown };
};

function normalizedLifecycleEventType(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toUpperCase();
  if (normalized === "FOREGROUND_ENTER" || normalized === "FOREGROUND_ENTER_EVENT") return 4;
  if (normalized === "FOREGROUND_EXIT" || normalized === "FOREGROUND_EXIT_EVENT") return 5;
  if (normalized === "ABNORMAL_EXIT" || normalized === "ABNORMAL_EXIT_EVENT") return 6;
  if (normalized === "SYSTEM_EXIT" || normalized === "SYSTEM_EXIT_EVENT") return 7;
  return undefined;
}

export function evenHubLifecycleActionFromEvent(event: EvenHubLifecycleEventLike): EvenHubLifecycleAction | null {
  const eventType = normalizedLifecycleEventType(event.sysEvent?.eventType);
  if (eventType === 4) return "foregroundEnter";
  if (eventType === 5) return "foregroundExit";
  if (eventType === 6) return "abnormalExit";
  if (eventType === 7) return "systemExit";
  return null;
}

export function shouldCloseGatewayForLifecycleAction(action: EvenHubLifecycleAction) {
  return action === "abnormalExit" || action === "systemExit";
}

export type EvenHubLifecycleRoute = "none" | "ignore" | "resume-foreground" | "pause-foreground" | "close-transport";

export function evenHubLifecycleRoute(input: {
  action: EvenHubLifecycleAction | null;
  shouldProcess: boolean;
}): EvenHubLifecycleRoute {
  if (!input.action) return "none";
  if (!input.shouldProcess) return "ignore";
  if (input.action === "foregroundEnter") return "resume-foreground";
  if (input.action === "foregroundExit") return "pause-foreground";
  if (shouldCloseGatewayForLifecycleAction(input.action)) return "close-transport";
  return "ignore";
}

export function createEvenHubLifecycleDedupe(
  now: () => number = () => Date.now(),
  windowMs = DEFAULT_LIFECYCLE_DEDUPE_WINDOW_MS,
) {
  let lastAction: EvenHubLifecycleAction | null = null;
  let lastAtMs = 0;

  return (action: EvenHubLifecycleAction) => {
    const currentAtMs = now();
    if (action === lastAction && currentAtMs - lastAtMs < windowMs) return false;
    lastAction = action;
    lastAtMs = currentAtMs;
    return true;
  };
}
