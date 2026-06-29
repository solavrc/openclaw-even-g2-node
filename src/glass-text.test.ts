import { describe, expect, it } from "vitest";
import {
  cleanGlassText,
  replaceUnsupportedGlassGlyphs,
} from "./glass-text";

describe("glass text normalization", () => {
  it("keeps documented Even G2 symbol glyphs and audited emoji glyphs", () => {
    expect(replaceUnsupportedGlassGlyphs("★ ☆ ♡ ♥ ▶️ ◀️ □ ■ ○ ● 👍 😊 😂 🙏 🔥")).toBe("★ ☆ ♡ ♥ ▶ ◀ □ ■ ○ ● 👍 😊 😂 🙏 🔥");
  });

  it("replaces unsupported emoji-like glyphs with a compact fallback", () => {
    expect(replaceUnsupportedGlassGlyphs("⚙️ 🔌 🔊 🪢")).toBe("[emoji] [emoji] [emoji] [emoji]");
    expect(replaceUnsupportedGlassGlyphs("🇯🇵 1️⃣")).toBe("[emoji] [emoji]");
  });

  it("drops ignored modifiers when Intl.Segmenter is unavailable", () => {
    const originalSegmenter = Intl.Segmenter;
    Object.defineProperty(Intl, "Segmenter", { configurable: true, value: undefined });
    try {
      expect(replaceUnsupportedGlassGlyphs("▶️ ⚙️")).toBe("▶ [emoji]");
    } finally {
      Object.defineProperty(Intl, "Segmenter", { configurable: true, value: originalSegmenter });
    }
  });

  it("leaves ordinary text unchanged while normalizing unsupported glyphs", () => {
    expect(cleanGlassText(" 日本語 tabs\tand `code` 🔌  ")).toBe("日本語 tabs and 'code' [emoji]");
  });
});
