import { describe, expect, it } from "vitest";
import { isSimulatorSourcePath } from "./simulator-source-fingerprint.js";

describe("isSimulatorSourcePath", () => {
  it("includes runtime files that can affect simulator screenshots", () => {
    expect(isSimulatorSourcePath("src/main.tsx")).toBe(true);
    expect(isSimulatorSourcePath("src/glass.ts")).toBe(true);
    expect(isSimulatorSourcePath("app.json")).toBe(true);
    expect(isSimulatorSourcePath("docs/testing.md")).toBe(true);
    expect(isSimulatorSourcePath("docs/user-stories.md")).toBe(true);
    expect(isSimulatorSourcePath("scripts/evenhub-simulator-e2e.ts")).toBe(true);
  });

  it("excludes test-only files from simulator fixture staleness checks", () => {
    expect(isSimulatorSourcePath("src/glass.test.ts")).toBe(false);
    expect(isSimulatorSourcePath("src/phone-ui.spec.tsx")).toBe(false);
    expect(isSimulatorSourcePath("scripts/release-status.test.ts")).toBe(false);
  });

  it("does not treat unrelated docs as simulator source", () => {
    expect(isSimulatorSourcePath("docs/architecture.md")).toBe(false);
  });
});
