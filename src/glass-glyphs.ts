const LATIN1_MISSING = new Set([0x00A8, 0x00AF, 0x00B4, 0x00B5, 0x00B8]);

export const DOCUMENTED_EVEN_G2_SYMBOL_GLYPHS = [
  0x2190, 0x2191, 0x2192, 0x2193, 0x2194, 0x2195, 0x2196, 0x2197, 0x2198, 0x2199, 0x21D2, 0x21D4,
  0x2550, 0x255E, 0x2561, 0x256A,
  0x2592, 0x2594, 0x2595,
  0x25A0, 0x25A1, 0x25A3, 0x25A4, 0x25A5, 0x25A6, 0x25A7, 0x25A8, 0x25A9,
  0x25B2, 0x25B3, 0x25B6, 0x25B7, 0x25BC, 0x25BD, 0x25C0, 0x25C1, 0x25C6, 0x25C7, 0x25C8,
  0x25CA, 0x25CB, 0x25CC, 0x25CE, 0x25CF, 0x25D0, 0x25D1, 0x25E2, 0x25E3, 0x25E4, 0x25E5, 0x25EF,
  0x2605, 0x2606, 0x2609, 0x260E, 0x260F, 0x261C, 0x261E,
  0x2660, 0x2661, 0x2663, 0x2664, 0x2665, 0x2667,
  0x2020, 0x203B, 0x2122, 0x221E,
  0x2070, 0x00B9, 0x00B2, 0x00B3, 0x2074, 0x2075, 0x2076, 0x2077, 0x2078, 0x2079,
  0x2080, 0x2081, 0x2082, 0x2083, 0x2084, 0x2085, 0x2086, 0x2087, 0x2088, 0x2089,
  0x00BC, 0x00BD, 0x215B,
] as const;

const DOCUMENTED_SYMBOL_SET = new Set<number>(DOCUMENTED_EVEN_G2_SYMBOL_GLYPHS);

function isRange(value: number, start: number, end: number) {
  return value >= start && value <= end;
}

export function isDocumentedEvenG2TextGlyph(codePoint: number) {
  if (codePoint === 0x000A || codePoint === 0x000D || codePoint === 0x0009) return true;
  if (isRange(codePoint, 0x0020, 0x007E)) return true;
  if (isRange(codePoint, 0x00A1, 0x00FF) && !LATIN1_MISSING.has(codePoint)) return true;
  if (isRange(codePoint, 0x2500, 0x2503)) return true;
  if (isRange(codePoint, 0x250C, 0x254B)) return true;
  if (isRange(codePoint, 0x256D, 0x2573)) return true;
  if (isRange(codePoint, 0x2581, 0x258F)) return true;
  if (codePoint === 0x3000) return true;
  if (isRange(codePoint, 0xFF10, 0xFF19)) return true;
  if (isRange(codePoint, 0xFF21, 0xFF3A)) return true;
  if (isRange(codePoint, 0xFF41, 0xFF5A)) return true;
  return DOCUMENTED_SYMBOL_SET.has(codePoint);
}

export function documentedEvenG2GlyphsText() {
  const codePoints = new Set<number>();
  for (let value = 0x0020; value <= 0x007E; value += 1) codePoints.add(value);
  for (let value = 0x00A1; value <= 0x00FF; value += 1) {
    if (!LATIN1_MISSING.has(value)) codePoints.add(value);
  }
  for (let value = 0x2500; value <= 0x2503; value += 1) codePoints.add(value);
  for (let value = 0x250C; value <= 0x254B; value += 1) codePoints.add(value);
  for (let value = 0x256D; value <= 0x2573; value += 1) codePoints.add(value);
  for (let value = 0x2581; value <= 0x258F; value += 1) codePoints.add(value);
  for (const codePoint of DOCUMENTED_EVEN_G2_SYMBOL_GLYPHS) codePoints.add(codePoint);
  return [...codePoints].sort((a, b) => a - b).map((codePoint) => String.fromCodePoint(codePoint)).join("");
}
