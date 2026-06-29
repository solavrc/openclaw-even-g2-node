import { describe, expect, it } from "vitest";
import { commandOutput, evenHubPackageAvailabilityProbeSummary } from "./release-check.ts";

describe("release command output capture", () => {
  it("combines stdout and stderr for optional Even Hub failure matching", () => {
    expect(commandOutput({
      stdout: "Failed to check package ID availability",
      stderr: "Please log in again",
      exitCode: 1,
    })).toBe("Failed to check package ID availability\nPlease log in again");
  });

  it("summarizes an owned package id as an expected successful availability probe", () => {
    expect(evenHubPackageAvailabilityProbeSummary({
      stdout: "Successfully packed /tmp/openclaw-node-check.ehpk\nPackage ID is already taken: com.solavrc.openclaweveng2node",
      stderr: "",
      exitCode: 0,
    })).toBe("package-id-already-owned");
  });
});
