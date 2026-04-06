export interface Env {
  TG_API_ID: string;
  TG_API_HASH: string;
  TG_SESSION: string;
  NAME_EXTRACT_REGEX?: string;
  NAME_EXTRACT_SOURCE?: string;
  MEMBER_TAG_EXTRACT_REGEX?: string;
  TG_GROUP_ID?: string;
  COUNTER: DurableObjectNamespace;
}

export interface CounterState {
  count: number;
}

export type CounterKey = "name" | "memberTag";
export type RegexTarget = "name" | "memberTag";
export type NameExtractSource = "first_name" | "last_name" | "full_name";

export interface WorkerResponseBody {
  count: number | null;
  extracted: string | null;
  memberTag: string | null;
  memberTagCount: number | null;
  memberTagExtracted: string | null;
  memberTagError: string | null;
}

export interface MemberTagState {
  tag: string | null;
  count: number | null;
  extracted: string | null;
  error: string | null;
}
