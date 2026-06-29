import { describe, expect, it } from "vitest";
import {
  documentedEvenG2GlyphsText,
  isDocumentedEvenG2TextGlyph,
} from "./glass-glyphs";

describe("Even G2 documented glyph coverage", () => {
  it("includes printable ASCII and documented symbol-like emoji glyphs", () => {
    expect(isDocumentedEvenG2TextGlyph("A".codePointAt(0) ?? 0)).toBe(true);
    expect(isDocumentedEvenG2TextGlyph("♡".codePointAt(0) ?? 0)).toBe(true);
    expect(isDocumentedEvenG2TextGlyph("♥".codePointAt(0) ?? 0)).toBe(true);
    expect(isDocumentedEvenG2TextGlyph("▶".codePointAt(0) ?? 0)).toBe(true);
    expect(isDocumentedEvenG2TextGlyph("□".codePointAt(0) ?? 0)).toBe(true);
    expect(isDocumentedEvenG2TextGlyph("★".codePointAt(0) ?? 0)).toBe(true);
  });

  it("does not treat unsupported emoji code points as documented text glyphs", () => {
    expect(isDocumentedEvenG2TextGlyph("⚙".codePointAt(0) ?? 0)).toBe(false);
    expect(isDocumentedEvenG2TextGlyph("🔌".codePointAt(0) ?? 0)).toBe(false);
    expect(isDocumentedEvenG2TextGlyph("👍".codePointAt(0) ?? 0)).toBe(false);
    expect(isDocumentedEvenG2TextGlyph("🪢".codePointAt(0) ?? 0)).toBe(false);
  });

  it("exports a stable probe string of documented glyphs", () => {
    const text = documentedEvenG2GlyphsText();
    expect(text).toContain("ABC");
    expect(text).toContain("♡");
    expect(text).toContain("▶");
    expect(text).not.toContain("🔌");
  });
});
