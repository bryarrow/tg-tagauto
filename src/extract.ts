import { createExtractRegex, getNameExtractSource, getNameSourceText } from "./config";
import { formatDigitsWithOriginalStyle } from "./digits";
import { Env, RegexTarget } from "./types";

interface MatchedSegment {
  extracted: string;
  start: number;
  end: number;
}

interface TextReplacementResult {
  value: string;
  extracted: string;
}

interface NameReplacementResult {
  firstName: string;
  lastName: string;
  extracted: string;
}

function getMatchedSegment(env: Env, target: RegexTarget, source: string): MatchedSegment | null {
  const regex = createExtractRegex(env, target);

  if (!regex) {
    return null;
  }

  const match = regex.exec(source);

  if (!match) {
    return null;
  }

  const extracted = match[1] ?? match[0] ?? "";
  const matchedText = match[0] ?? "";
  const start = match.index + matchedText.indexOf(extracted);

  return {
    extracted,
    start,
    end: start + extracted.length
  };
}

export function extractFromText(env: Env, target: RegexTarget, source: string): string | null {
  return getMatchedSegment(env, target, source)?.extracted ?? null;
}

export function extractFromName(env: Env, firstName: string, lastName: string): string | null {
  return extractFromText(env, "name", getNameSourceText(env, firstName, lastName));
}

export function replaceMatchedDigits(
  env: Env,
  target: RegexTarget,
  source: string,
  nextCount: number
): TextReplacementResult | null {
  const matched = getMatchedSegment(env, target, source);

  if (!matched) {
    return null;
  }

  const formattedCount = formatDigitsWithOriginalStyle(matched.extracted, String(nextCount));

  return {
    value: `${source.slice(0, matched.start)}${formattedCount}${source.slice(matched.end)}`,
    extracted: formattedCount
  };
}

export function replaceNameDigits(
  env: Env,
  firstName: string,
  lastName: string,
  nextCount: number
): NameReplacementResult | null {
  const sourceType = getNameExtractSource(env);

  if (sourceType === "first_name") {
    const nextName = replaceMatchedDigits(env, "name", firstName, nextCount);

    return nextName
      ? { firstName: nextName.value, lastName, extracted: nextName.extracted }
      : null;
  }

  if (sourceType === "last_name") {
    const nextName = replaceMatchedDigits(env, "name", lastName, nextCount);

    return nextName
      ? { firstName, lastName: nextName.value, extracted: nextName.extracted }
      : null;
  }

  const source = getNameSourceText(env, firstName, lastName);
  const matched = getMatchedSegment(env, "name", source);

  if (!matched) {
    return null;
  }

  if (matched.start < firstName.length && matched.end > firstName.length) {
    return null;
  }

  const formattedCount = formatDigitsWithOriginalStyle(matched.extracted, String(nextCount));

  if (matched.end <= firstName.length) {
    return {
      firstName: `${firstName.slice(0, matched.start)}${formattedCount}${firstName.slice(matched.end)}`,
      lastName,
      extracted: formattedCount
    };
  }

  const localStart = matched.start - firstName.length;
  const localEnd = matched.end - firstName.length;

  return {
    firstName,
    lastName: `${lastName.slice(0, localStart)}${formattedCount}${lastName.slice(localEnd)}`,
    extracted: formattedCount
  };
}
