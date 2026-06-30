import { describe, expect, it } from "vitest";
import { FIXTURE_FLOWS, simulatorFixtureAppUrl } from "./evenhub-simulator-fixtures.ts";

describe("simulator fixture runner helpers", () => {
  it("includes the phone session selector flow in the aggregate fixture smoke", () => {
    expect(FIXTURE_FLOWS).toContain("sessionSelector");
  });

  it("starts the session selector flow from the session fixture URL", () => {
    expect(simulatorFixtureAppUrl("sessionSelector", 5174)).toBe(
      "http://127.0.0.1:5174/?resetPairing=1&simFixture=session&simSessionSelectorFlow=1",
    );
  });

  it("keeps normal fixture URLs unchanged", () => {
    expect(simulatorFixtureAppUrl("canvas", 5174)).toBe(
      "http://127.0.0.1:5174/?resetPairing=1&simFixture=canvas",
    );
  });
});
