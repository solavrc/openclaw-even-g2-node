import { isDocumentedEvenG2TextGlyph } from "./glass-glyphs";

const IGNORED_GLYPH_MODIFIERS = new Set([0x200D, 0xFE0E, 0xFE0F]);
const AUDITED_EVEN_G2_EMOJI_GLYPHS = new Set(["👍", "😊", "😂", "🙏", "🔥"]);
const UNSUPPORTED_EMOJI_FALLBACK = "[emoji]";

function graphemeClusters(text: string) {
  if (typeof Intl.Segmenter === "function") {
    const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
    return [...segmenter.segment(text)].map((segment) => segment.segment);
  }
  return [...text];
}

function codePoints(text: string) {
  return [...text].map((char) => char.codePointAt(0)).filter((value): value is number => value !== undefined);
}

function visibleCodePoints(text: string) {
  return codePoints(text).filter((codePoint) => !IGNORED_GLYPH_MODIFIERS.has(codePoint));
}

function isDocumentedGlyphCluster(cluster: string) {
  const visible = visibleCodePoints(cluster);
  return visible.length > 0 && visible.every(isDocumentedEvenG2TextGlyph);
}

function documentedGlyphClusterText(cluster: string) {
  return visibleCodePoints(cluster).map((codePoint) => String.fromCodePoint(codePoint)).join("");
}

function isEmojiLikeCluster(cluster: string) {
  return /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{20E3}]/u.test(cluster)
    || /\p{Extended_Pictographic}/u.test(cluster);
}

export function replaceUnsupportedGlassGlyphs(text: string) {
  return graphemeClusters(text).map((cluster) => {
    if (!cluster) return "";
    if (visibleCodePoints(cluster).length === 0) return "";
    if (isDocumentedGlyphCluster(cluster)) return documentedGlyphClusterText(cluster);
    if (AUDITED_EVEN_G2_EMOJI_GLYPHS.has(cluster)) return cluster;
    if (!isEmojiLikeCluster(cluster)) return cluster;
    return UNSUPPORTED_EMOJI_FALLBACK;
  }).join("");
}

export function cleanGlassText(text: string) {
  return replaceUnsupportedGlassGlyphs(text)
    .replace(/`/g, "'")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\t/g, " ").replace(/[ ]+$/g, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
