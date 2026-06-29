import { sessionTranscriptDisplayFrames } from "./glass";
import type { SessionTranscriptMessage } from "./glass";

export const SESSION_TRANSCRIPT_INITIAL_RAW_LIMIT = 160;
export const SESSION_TRANSCRIPT_MAX_RAW_LIMIT = 16384;
export const SESSION_TRANSCRIPT_AUTO_EXPAND_FACTOR = 2;

export function sessionTranscriptRequestLimit(limit: number | undefined, currentRawLimit: number) {
  return Math.max(1, Math.min(
    SESSION_TRANSCRIPT_MAX_RAW_LIMIT,
    Math.floor(limit ?? currentRawLimit),
  ));
}

export function maxSessionLogCursor(messages: SessionTranscriptMessage[]) {
  return Math.max(0, visibleSessionTranscriptScreenCount(messages) - 1);
}

export function visibleSessionTranscriptScreenCount(messages: SessionTranscriptMessage[]) {
  return sessionTranscriptDisplayFrames(messages).length;
}

export function nextEarlierSessionTranscriptLimit(currentLimit: number) {
  return Math.min(
    SESSION_TRANSCRIPT_MAX_RAW_LIMIT,
    Math.max(currentLimit + 1, currentLimit * 2),
  );
}

export type EarlierSessionTranscriptRequestPlan =
  | { action: "skip"; result: false }
  | { action: "already-loading"; result: true }
  | { action: "limit-reached"; result: false; status: "history limit reached"; renderStatus: "start of log" }
  | { action: "request"; result: true; limit: number; status: "loading earlier log" };

export function earlierSessionTranscriptRequestPlan(input: {
  sessionKey: string;
  hasFullHistory: boolean;
  loadingLimit: number | null;
  currentRawLimit: number;
}): EarlierSessionTranscriptRequestPlan {
  if (!input.sessionKey || input.hasFullHistory) return { action: "skip", result: false };
  if (input.loadingLimit !== null) return { action: "already-loading", result: true };
  const nextLimit = nextEarlierSessionTranscriptLimit(input.currentRawLimit);
  if (nextLimit <= input.currentRawLimit) {
    return {
      action: "limit-reached",
      result: false,
      status: "history limit reached",
      renderStatus: "start of log",
    };
  }
  return {
    action: "request",
    result: true,
    limit: nextLimit,
    status: "loading earlier log",
  };
}

export function shouldAutoExpandToolHeavyHistory(input: {
  error?: string;
  visibleScreenCount: number;
  rawCount: number;
  hasFullHistory: boolean;
  rawLimit: number;
}) {
  return !input.error
    && input.visibleScreenCount === 0
    && input.rawCount > 0
    && !input.hasFullHistory
    && input.rawLimit < SESSION_TRANSCRIPT_MAX_RAW_LIMIT;
}

export function autoExpandToolHeavyHistoryLimit(rawLimit: number) {
  return Math.min(
    SESSION_TRANSCRIPT_MAX_RAW_LIMIT,
    Math.max(
      rawLimit + SESSION_TRANSCRIPT_INITIAL_RAW_LIMIT,
      rawLimit * SESSION_TRANSCRIPT_AUTO_EXPAND_FACTOR,
    ),
  );
}

export function nextSessionLogCursorAfterSnapshot(input: {
  currentCursor: number;
  messages: SessionTranscriptMessage[];
  expandedHistory: boolean;
}) {
  const maxCursor = maxSessionLogCursor(input.messages);
  return input.expandedHistory ? maxCursor : Math.min(input.currentCursor, maxCursor);
}

export type SessionLogCursorDirection = "up" | "down";

export function nextSessionLogCursorForDirection(input: {
  currentCursor: number;
  maxCursor: number;
  direction: SessionLogCursorDirection;
}) {
  const delta = input.direction === "up" ? 1 : -1;
  return Math.max(0, Math.min(input.maxCursor, input.currentCursor + delta));
}

export function optimisticSessionUserMessageUpdate(input: {
  currentSessionKey: string;
  targetSessionKey: string;
  messages: SessionTranscriptMessage[];
  text: string;
  idempotencyKey: string;
  timestamp: string;
}) {
  if (input.targetSessionKey !== input.currentSessionKey) {
    return { appended: false, messages: input.messages };
  }
  return {
    appended: true,
    messages: [
      ...input.messages,
      {
        id: input.idempotencyKey,
        role: "user" as const,
        text: input.text,
        timestamp: input.timestamp,
      },
    ],
  };
}

export type PendingHistoryExpand = {
  sessionKey: string;
  limit: number;
};

export type SessionTranscriptSnapshotInput = {
  sessionKey?: string;
  messages?: SessionTranscriptMessage[];
  rawLimit?: number;
  rawCount?: number;
  hasFullHistory?: boolean;
  error?: string;
};

function finiteNumberOr(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function snapshotRawMetrics(snapshot: SessionTranscriptSnapshotInput, loadingLimit: number | null, currentRawLimit: number, messageCount: number) {
  const rawLimit = finiteNumberOr(snapshot.rawLimit, loadingLimit ?? currentRawLimit);
  const rawCount = finiteNumberOr(snapshot.rawCount, messageCount);
  return {
    rawLimit,
    rawCount,
    hasFullHistory: snapshot.hasFullHistory === true || rawCount < rawLimit,
  };
}

function isExpandedHistorySnapshot(snapshot: SessionTranscriptSnapshotInput, pendingExpand: PendingHistoryExpand | null, rawLimit: number) {
  return Boolean(
    pendingExpand
      && (!snapshot.sessionKey || pendingExpand.sessionKey === snapshot.sessionKey)
      && pendingExpand.limit === rawLimit,
  );
}

function expandedSnapshotMessages(
  messages: SessionTranscriptMessage[],
  existingMessages: SessionTranscriptMessage[],
  expandedHistory: boolean,
) {
  const shouldKeepExistingExpandedHistory = expandedHistory
    && messages.length === 0
    && existingMessages.length > 0;
  return {
    shouldKeepExistingExpandedHistory,
    nextMessages: shouldKeepExistingExpandedHistory ? existingMessages : messages,
  };
}

function snapshotAutoExpandPlan(input: {
  error?: string;
  messages: SessionTranscriptMessage[];
  rawCount: number;
  hasFullHistory: boolean;
  rawLimit: number;
}) {
  const visibleScreenCount = visibleSessionTranscriptScreenCount(input.messages);
  const shouldAutoExpand = shouldAutoExpandToolHeavyHistory({
    error: input.error,
    visibleScreenCount,
    rawCount: input.rawCount,
    hasFullHistory: input.hasFullHistory,
    rawLimit: input.rawLimit,
  });
  return {
    visibleScreenCount,
    shouldAutoExpand,
    autoExpandLimit: shouldAutoExpand ? autoExpandToolHeavyHistoryLimit(input.rawLimit) : null,
  };
}

export function sessionTranscriptSnapshotUpdate(input: {
  snapshot: SessionTranscriptSnapshotInput;
  loadingLimit: number | null;
  currentRawLimit: number;
  existingMessages: SessionTranscriptMessage[];
  currentCursor: number;
  pendingExpand: PendingHistoryExpand | null;
}) {
  const messages = Array.isArray(input.snapshot.messages) ? input.snapshot.messages : [];
  const { rawLimit, rawCount, hasFullHistory } = snapshotRawMetrics(
    input.snapshot,
    input.loadingLimit,
    input.currentRawLimit,
    messages.length,
  );
  const expandedHistory = isExpandedHistorySnapshot(input.snapshot, input.pendingExpand, rawLimit);
  const { shouldKeepExistingExpandedHistory, nextMessages } = expandedSnapshotMessages(
    messages,
    input.existingMessages,
    expandedHistory,
  );
  const nextRawLimit = Math.max(input.currentRawLimit, rawLimit);
  const autoExpand = snapshotAutoExpandPlan({
    error: input.snapshot.error,
    messages,
    rawCount,
    hasFullHistory,
    rawLimit,
  });

  return {
    messages,
    rawLimit,
    rawCount,
    expandedHistory,
    clearPendingExpand: expandedHistory,
    shouldKeepExistingExpandedHistory,
    nextMessages,
    nextRawLimit,
    hasFullHistory,
    visibleScreenCount: autoExpand.visibleScreenCount,
    shouldAutoExpand: autoExpand.shouldAutoExpand,
    autoExpandLimit: autoExpand.autoExpandLimit,
    nextCursor: nextSessionLogCursorAfterSnapshot({
      currentCursor: input.currentCursor,
      messages: nextMessages,
      expandedHistory,
    }),
  };
}

export function nextSessionTranscriptStatusAfterSnapshot(input: {
  error?: string;
  expandedHistory: boolean;
  visibleScreenCount: number;
  currentStatus: string;
}) {
  if (input.error) return input.currentStatus;
  const shouldReturnReady = (input.expandedHistory && input.currentStatus === "loading earlier log")
    || (input.visibleScreenCount > 0 && input.currentStatus === "loading session log");
  return shouldReturnReady ? "ready" : input.currentStatus;
}
