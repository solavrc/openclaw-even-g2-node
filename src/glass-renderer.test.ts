import { describe, expect, it } from "vitest";
import {
  GLASS_CANVAS_HEIGHT,
  GLASS_CANVAS_WIDTH,
  displayTextForGlass,
  glassFrameFromInput,
  renderGlassTextFrame,
  renderGlassVoicePanelFrame,
} from "./glass-renderer";

function fakeBridge() {
  const calls = {
    create: 0,
    rebuild: 0,
    upgrade: [] as unknown[],
  };
  const bridge = {
    createStartUpPageContainer: async () => {
      calls.create += 1;
      return 0;
    },
    rebuildPageContainer: async () => {
      calls.rebuild += 1;
      return true;
    },
    textContainerUpgrade: async (input: unknown) => {
      calls.upgrade.push(input);
      return true;
    },
  };
  return { bridge, calls };
}

describe("glass renderer helpers", () => {
  it("exports the Even G2 canvas dimensions used by node capabilities", () => {
    expect(GLASS_CANVAS_WIDTH).toBe(576);
    expect(GLASS_CANVAS_HEIGHT).toBe(288);
  });

  it("normalizes legacy plain text frames", () => {
    expect(displayTextForGlass(" main ` note\n\n\nhello\tworld ")).toBe("main ' note\n\nhello world");
    expect(glassFrameFromInput("main\n\nhello\n\nhint")).toEqual({
      header: "main",
      body: "hello",
      hint: "hint",
    });
  });

  it("accepts structured HUD frame input", () => {
    expect(glassFrameFromInput({ header: "H", body: "B", hint: "T" })).toEqual({
      header: "H",
      body: "B",
      hint: "T",
    });
  });

  it("does not resend unchanged text frame containers", async () => {
    const { bridge, calls } = fakeBridge();
    await expect(renderGlassTextFrame(bridge, { header: "H", body: "B", hint: "T" })).resolves.toBe(true);
    await expect(renderGlassTextFrame(bridge, { header: "H", body: "B", hint: "T" })).resolves.toBe(true);
    expect(calls.create).toBe(1);
    expect(calls.rebuild).toBe(0);
    expect(calls.upgrade).toHaveLength(0);

    await expect(renderGlassTextFrame(bridge, { header: "H", body: "B2", hint: "T" })).resolves.toBe(true);
    expect(calls.upgrade).toHaveLength(1);
  });

  it("does not resend unchanged voice panel containers", async () => {
    const { bridge, calls } = fakeBridge();
    const frame = {
      base: { header: "main · ready", body: "session text", hint: "tap speak" },
      title: "Review voice",
      body: "draft",
      hint: "tap send",
    };
    await expect(renderGlassVoicePanelFrame(bridge, frame)).resolves.toBe(true);
    await expect(renderGlassVoicePanelFrame(bridge, frame)).resolves.toBe(true);
    expect(calls.create).toBe(1);
    expect(calls.rebuild).toBe(0);
    expect(calls.upgrade).toHaveLength(0);

    await expect(renderGlassVoicePanelFrame(bridge, { ...frame, body: "draft changed" })).resolves.toBe(true);
    expect(calls.upgrade).toHaveLength(1);
  });
});
