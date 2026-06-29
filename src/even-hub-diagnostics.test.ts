import { describe, expect, it } from "vitest";
import { jsonSafeValue, parseEvenHubEventLogs } from "./even-hub-diagnostics";

describe("jsonSafeValue", () => {
  it("serializes special JavaScript values without throwing", () => {
    const value: Record<string, unknown> = {
      bytes: new Uint8Array([1, 2, 3]),
      missing: undefined,
      big: 12n,
    };
    value.self = value;

    expect(jsonSafeValue(value)).toMatchObject({
      bytes: {
        $type: "Uint8Array",
        byteLength: 3,
        previewHex: "01 02 03",
      },
      big: { $type: "bigint", value: "12" },
      self: {
        circular: true,
      },
    });
    expect(jsonSafeValue(value)).not.toHaveProperty("missing");
  });
});

describe("parseEvenHubEventLogs", () => {
  it("keeps object entries up to the requested limit", () => {
    expect(parseEvenHubEventLogs([{ id: 1 }, null, "bad", { id: 2 }], 1)).toEqual([{ id: 1 }]);
  });
});
