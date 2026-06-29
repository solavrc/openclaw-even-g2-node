import { afterEach, describe, expect, it, vi } from "vitest";
import { clearWindowTimeoutRef } from "./timer-ref";

describe("clearWindowTimeoutRef", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("clears and resets a stored window timeout", () => {
    const clearTimeoutSpy = vi.spyOn(window, "clearTimeout").mockImplementation(() => undefined);
    const timerRef = { current: 123 };

    expect(clearWindowTimeoutRef(timerRef)).toBe(true);

    expect(clearTimeoutSpy).toHaveBeenCalledWith(123);
    expect(timerRef.current).toBeNull();
  });

  it("does nothing when the ref is already empty", () => {
    const clearTimeoutSpy = vi.spyOn(window, "clearTimeout").mockImplementation(() => undefined);
    const timerRef = { current: null };

    expect(clearWindowTimeoutRef(timerRef)).toBe(false);

    expect(clearTimeoutSpy).not.toHaveBeenCalled();
    expect(timerRef.current).toBeNull();
  });
});
