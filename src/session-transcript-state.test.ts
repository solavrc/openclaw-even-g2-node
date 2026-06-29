import { describe, expect, it } from "vitest";
import type { SessionTranscriptMessage } from "./glass";
import {
  SESSION_TRANSCRIPT_INITIAL_RAW_LIMIT,
  SESSION_TRANSCRIPT_MAX_RAW_LIMIT,
  autoExpandToolHeavyHistoryLimit,
  earlierSessionTranscriptRequestPlan,
  maxSessionLogCursor,
  nextEarlierSessionTranscriptLimit,
  nextSessionLogCursorForDirection,
  nextSessionLogCursorAfterSnapshot,
  nextSessionTranscriptStatusAfterSnapshot,
  optimisticSessionUserMessageUpdate,
  sessionTranscriptRequestLimit,
  sessionTranscriptSnapshotUpdate,
  shouldAutoExpandToolHeavyHistory,
  visibleSessionTranscriptScreenCount,
} from "./session-transcript-state";

const visibleMessages: SessionTranscriptMessage[] = [
  { role: "user", text: "question" },
  { role: "assistant", text: "answer" },
];

describe("session transcript state", () => {
  it("clamps requested transcript limits", () => {
    expect(sessionTranscriptRequestLimit(undefined, 42)).toBe(42);
    expect(sessionTranscriptRequestLimit(0, 42)).toBe(1);
    expect(sessionTranscriptRequestLimit(SESSION_TRANSCRIPT_MAX_RAW_LIMIT + 1, 42)).toBe(SESSION_TRANSCRIPT_MAX_RAW_LIMIT);
    expect(sessionTranscriptRequestLimit(12.8, 42)).toBe(12);
  });

  it("computes visible screen count and cursor bounds", () => {
    const screenCount = visibleSessionTranscriptScreenCount(visibleMessages);
    expect(screenCount).toBeGreaterThan(0);
    expect(maxSessionLogCursor([])).toBe(0);
    expect(maxSessionLogCursor(visibleMessages)).toBe(screenCount - 1);
  });

  it("expands earlier history without exceeding the max", () => {
    expect(nextEarlierSessionTranscriptLimit(10)).toBe(20);
    expect(nextEarlierSessionTranscriptLimit(SESSION_TRANSCRIPT_MAX_RAW_LIMIT)).toBe(SESSION_TRANSCRIPT_MAX_RAW_LIMIT);
  });

  it("plans earlier transcript requests", () => {
    expect(earlierSessionTranscriptRequestPlan({
      sessionKey: "",
      hasFullHistory: false,
      loadingLimit: null,
      currentRawLimit: 160,
    })).toEqual({ action: "skip", result: false });
    expect(earlierSessionTranscriptRequestPlan({
      sessionKey: "session",
      hasFullHistory: true,
      loadingLimit: null,
      currentRawLimit: 160,
    })).toEqual({ action: "skip", result: false });
    expect(earlierSessionTranscriptRequestPlan({
      sessionKey: "session",
      hasFullHistory: false,
      loadingLimit: 320,
      currentRawLimit: 160,
    })).toEqual({ action: "already-loading", result: true });
    expect(earlierSessionTranscriptRequestPlan({
      sessionKey: "session",
      hasFullHistory: false,
      loadingLimit: null,
      currentRawLimit: SESSION_TRANSCRIPT_MAX_RAW_LIMIT,
    })).toEqual({
      action: "limit-reached",
      result: false,
      status: "history limit reached",
      renderStatus: "start of log",
    });
    expect(earlierSessionTranscriptRequestPlan({
      sessionKey: "session",
      hasFullHistory: false,
      loadingLimit: null,
      currentRawLimit: 160,
    })).toEqual({
      action: "request",
      result: true,
      limit: 320,
      status: "loading earlier log",
    });
  });

  it("detects tool-heavy snapshots that need automatic expansion", () => {
    expect(shouldAutoExpandToolHeavyHistory({
      visibleScreenCount: 0,
      rawCount: 4,
      hasFullHistory: false,
      rawLimit: SESSION_TRANSCRIPT_INITIAL_RAW_LIMIT,
    })).toBe(true);
    expect(shouldAutoExpandToolHeavyHistory({
      visibleScreenCount: 1,
      rawCount: 4,
      hasFullHistory: false,
      rawLimit: SESSION_TRANSCRIPT_INITIAL_RAW_LIMIT,
    })).toBe(false);
  });

  it("computes automatic expansion and snapshot cursors", () => {
    expect(autoExpandToolHeavyHistoryLimit(80)).toBe(240);
    expect(autoExpandToolHeavyHistoryLimit(SESSION_TRANSCRIPT_MAX_RAW_LIMIT)).toBe(SESSION_TRANSCRIPT_MAX_RAW_LIMIT);
    expect(nextSessionLogCursorAfterSnapshot({
      currentCursor: 4,
      messages: [],
      expandedHistory: false,
    })).toBe(0);
  });

  it("moves the session log cursor within bounds", () => {
    expect(nextSessionLogCursorForDirection({ currentCursor: 1, maxCursor: 4, direction: "up" })).toBe(2);
    expect(nextSessionLogCursorForDirection({ currentCursor: 1, maxCursor: 4, direction: "down" })).toBe(0);
    expect(nextSessionLogCursorForDirection({ currentCursor: 4, maxCursor: 4, direction: "up" })).toBe(4);
    expect(nextSessionLogCursorForDirection({ currentCursor: 0, maxCursor: 4, direction: "down" })).toBe(0);
  });

  it("appends optimistic user messages only for the active session", () => {
    expect(optimisticSessionUserMessageUpdate({
      currentSessionKey: "session-a",
      targetSessionKey: "session-a",
      messages: visibleMessages,
      text: "voice text",
      idempotencyKey: "idem-1",
      timestamp: "2026-06-28T00:00:00.000Z",
    })).toEqual({
      appended: true,
      messages: [
        ...visibleMessages,
        {
          id: "idem-1",
          role: "user",
          text: "voice text",
          timestamp: "2026-06-28T00:00:00.000Z",
        },
      ],
    });
    const inactiveUpdate = optimisticSessionUserMessageUpdate({
      currentSessionKey: "session-a",
      targetSessionKey: "session-b",
      messages: visibleMessages,
      text: "voice text",
      idempotencyKey: "idem-1",
      timestamp: "2026-06-28T00:00:00.000Z",
    });
    expect(inactiveUpdate.appended).toBe(false);
    expect(inactiveUpdate.messages).toBe(visibleMessages);
  });

  it("keeps existing expanded history when the expanded snapshot is empty", () => {
    const update = sessionTranscriptSnapshotUpdate({
      snapshot: { sessionKey: "session-a", messages: [], rawLimit: 320, rawCount: 0 },
      loadingLimit: 320,
      currentRawLimit: 160,
      existingMessages: visibleMessages,
      currentCursor: 0,
      pendingExpand: { sessionKey: "session-a", limit: 320 },
    });

    expect(update.expandedHistory).toBe(true);
    expect(update.clearPendingExpand).toBe(true);
    expect(update.shouldKeepExistingExpandedHistory).toBe(true);
    expect(update.nextMessages).toBe(visibleMessages);
    expect(update.nextRawLimit).toBe(320);
    expect(update.hasFullHistory).toBe(true);
  });

  it("detects tool-heavy snapshots during snapshot update", () => {
    const update = sessionTranscriptSnapshotUpdate({
      snapshot: {
        messages: [{ role: "tool", text: "[tool output hidden]" }],
        rawLimit: 160,
        rawCount: 160,
      },
      loadingLimit: null,
      currentRawLimit: 160,
      existingMessages: [],
      currentCursor: 0,
      pendingExpand: null,
    });

    expect(update.shouldAutoExpand).toBe(true);
    expect(update.autoExpandLimit).toBe(320);
  });

  it("computes post-snapshot status transitions", () => {
    expect(nextSessionTranscriptStatusAfterSnapshot({
      expandedHistory: true,
      visibleScreenCount: 0,
      currentStatus: "loading earlier log",
    })).toBe("ready");
    expect(nextSessionTranscriptStatusAfterSnapshot({
      visibleScreenCount: 1,
      expandedHistory: false,
      currentStatus: "loading session log",
    })).toBe("ready");
    expect(nextSessionTranscriptStatusAfterSnapshot({
      error: "log unavailable",
      visibleScreenCount: 1,
      expandedHistory: false,
      currentStatus: "loading session log",
    })).toBe("loading session log");
  });
});
