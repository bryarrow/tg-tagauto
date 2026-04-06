import { Env, NameExtractSource, RegexTarget } from "./types";

export function getNameExtractSource(env: Env): NameExtractSource {
  const source = env.NAME_EXTRACT_SOURCE?.trim().toLowerCase();

  if (source === "first_name" || source === "last_name" || source === "full_name") {
    return source;
  }

  return "full_name";
}

export function getNameSourceText(env: Env, firstName: string, lastName: string): string {
  const source = getNameExtractSource(env);

  if (source === "first_name") {
    return firstName;
  }

  if (source === "last_name") {
    return lastName;
  }

  return `${firstName}${lastName}`.trim();
}

export function createExtractRegex(env: Env, target: RegexTarget): RegExp | null {
  const pattern = target === "name"
    ? env.NAME_EXTRACT_REGEX?.trim()
    : env.MEMBER_TAG_EXTRACT_REGEX?.trim();

  return pattern ? new RegExp(pattern) : null;
}

export function getGroupId(env: Env): number | string | null {
  const groupId = env.TG_GROUP_ID?.trim();

  if (!groupId) {
    return null;
  }

  return /^-?\d+$/.test(groupId) ? Number(groupId) : groupId;
}
