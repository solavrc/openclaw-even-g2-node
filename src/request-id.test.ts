import { describe, expect, it } from "vitest";
import { createRequestId } from "./request-id";

describe("createRequestId", () => {
  it("returns a non-empty request id", () => {
    expect(createRequestId()).toMatch(/\S/);
  });
});
