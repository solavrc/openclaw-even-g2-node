import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  _backgroundStateGlobalsInstalledForTests,
  _resetBackgroundStateForTests,
  onBackgroundRestore,
  setBackgroundState,
} from "./background-state";

type BackgroundStateGlobal = typeof globalThis & {
  __getStateSnapshot?: () => string;
  __restoreState?: (snapshot: unknown) => void;
};

function backgroundGlobal() {
  return globalThis as BackgroundStateGlobal;
}

describe("background-state", () => {
  beforeEach(() => {
    _resetBackgroundStateForTests();
  });

  it("installs Even Hub snapshot globals on module load", () => {
    expect(_backgroundStateGlobalsInstalledForTests()).toBe(true);
    expect(typeof backgroundGlobal().__getStateSnapshot).toBe("function");
    expect(typeof backgroundGlobal().__restoreState).toBe("function");
  });

  it("serializes registered snapshots by key", () => {
    const unset = setBackgroundState("node", () => ({ selectedSessionKey: "agent:main:main" }));

    const raw = backgroundGlobal().__getStateSnapshot?.();
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw || "{}")).toEqual({
      node: { selectedSessionKey: "agent:main:main" },
    });

    unset();
    expect(JSON.parse(backgroundGlobal().__getStateSnapshot?.() || "{}")).toEqual({});
  });

  it("skips non-serializable snapshots without dropping other keys", () => {
    setBackgroundState("bad", () => BigInt(1));
    setBackgroundState("good", () => ({ selectedSessionKey: "agent:main:main" }));

    expect(JSON.parse(backgroundGlobal().__getStateSnapshot?.() || "{}")).toEqual({
      good: { selectedSessionKey: "agent:main:main" },
    });
  });

  it("buffers restores that arrive before a restorer registers", () => {
    backgroundGlobal().__restoreState?.(JSON.stringify({
      node: { selectedSessionKey: "agent:main:later" },
    }));

    const restorer = vi.fn();
    onBackgroundRestore("node", restorer);

    expect(restorer).toHaveBeenCalledWith({ selectedSessionKey: "agent:main:later" });
    expect(restorer).toHaveBeenCalledTimes(1);
  });

  it("accepts object restore payloads as well as JSON strings", () => {
    const restorer = vi.fn();
    onBackgroundRestore("node", restorer);

    backgroundGlobal().__restoreState?.({
      node: { selectedSessionKey: "agent:main:object" },
    });

    expect(restorer).toHaveBeenCalledWith({ selectedSessionKey: "agent:main:object" });
  });

  it("ignores malformed restore payloads", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const restorer = vi.fn();
    onBackgroundRestore("node", restorer);

    backgroundGlobal().__restoreState?.("{not json");
    backgroundGlobal().__restoreState?.("[]");

    expect(restorer).not.toHaveBeenCalled();
    const [message, error] = consoleError.mock.calls[0] || [];
    expect(message).toBe("[background-state] restore parse failed");
    expect(error).toBeInstanceOf(SyntaxError);
  });
});
