type DigitStyleInfo =
  | { kind: "range"; zeroCodePoint: number }
  | { kind: "superscript" };

const SUPERSCRIPT_DIGITS = "⁰¹²³⁴⁵⁶⁷⁸⁹";
const ZERO_CODE_POINTS = [
  0x0660, 0x06f0, 0x07c0, 0x0966, 0x09e6, 0x0a66, 0x0ae6, 0x0b66, 0x0be6,
  0x0c66, 0x0ce6, 0x0d66, 0x0de6, 0x0e50, 0x0ed0, 0x0f20, 0x1040, 0x1090,
  0x17e0, 0x1810, 0x1946, 0x19d0, 0x1a80, 0x1a90, 0x1b50, 0x1bb0, 0x1c40,
  0x1c50, 0xa620, 0xa8d0, 0xa900, 0xa9d0, 0xa9f0, 0xaa50, 0xabf0, 0xff10
];

function getDigitStyleInfo(char: string): DigitStyleInfo | null {
  const codePoint = char.codePointAt(0);

  if (codePoint === undefined) {
    return null;
  }

  if (SUPERSCRIPT_DIGITS.includes(char)) {
    return { kind: "superscript" };
  }

  for (const zeroCodePoint of ZERO_CODE_POINTS) {
    const delta = codePoint - zeroCodePoint;

    if (delta >= 0 && delta <= 9) {
      return { kind: "range", zeroCodePoint };
    }
  }

  return null;
}

export function normalizeUnicodeDigits(input: string): string {
  const normalized = input.normalize("NFKC");
  let result = "";

  for (const char of normalized) {
    if (char >= "0" && char <= "9") {
      result += char;
      continue;
    }

    const codePoint = char.codePointAt(0);

    if (codePoint === undefined) {
      continue;
    }

    const styleInfo = getDigitStyleInfo(char);

    if (styleInfo?.kind === "range") {
      result += String(codePoint - styleInfo.zeroCodePoint);
    }
  }

  return result;
}

export function formatDigitsWithOriginalStyle(template: string, digits: string): string {
  const styleSample = [...template].find((char) => normalizeUnicodeDigits(char).length > 0);

  if (!styleSample) {
    return digits;
  }

  const styleInfo = getDigitStyleInfo(styleSample);

  if (!styleInfo) {
    return digits;
  }

  if (styleInfo.kind === "superscript") {
    return [...digits].map((digit) => SUPERSCRIPT_DIGITS[Number(digit)]).join("");
  }

  let formatted = "";

  for (const digit of digits) {
    formatted += String.fromCodePoint(styleInfo.zeroCodePoint + Number(digit));
  }

  return formatted;
}
