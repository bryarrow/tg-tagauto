/// <reference types="@cloudflare/workers-types" />
/// <reference path="./wasm.d.ts" />

import mtcuteWasmModule from "@mtcute/wasm/mtcute.wasm";
import { BaseTelegramClient as CoreBaseTelegramClient, TelegramClient as CoreTelegramClient } from "@mtcute/core/client.js";
import { MemoryStorage, WebCryptoProvider, WebPlatform, WebSocketTransport } from "@mtcute/web";

interface Env {
  TG_API_ID: string;
  TG_API_HASH: string;
  TG_SESSION: string;
  NAME_EXTRACT_REGEX?: string;
  NAME_EXTRACT_SOURCE?: string;
  MEMBER_TAG_EXTRACT_REGEX?: string;
  TG_GROUP_ID?: string;
  COUNTER: DurableObjectNamespace;
}

type MtcuteClient = CoreTelegramClient;

type CreateClientResult =
  | { ok: false; error: Response }
  | {
      ok: true;
      client: MtcuteClient;
    };

interface CounterState {
  count: number;
}

type CounterKey = "name" | "memberTag";

interface WorkerResponseBody {
  count: number | null;
  extracted: string | null;
  memberTag: string | null;
  memberTagCount: number | null;
  memberTagExtracted: string | null;
  memberTagError: string | null;
}

async function createClient(env: Env): Promise<CreateClientResult> {
  const apiId = Number(env.TG_API_ID);
  const apiHash = env.TG_API_HASH?.trim();
  const session = env.TG_SESSION?.trim();

  if (!apiId || !apiHash || !session) {
    return {
      ok: false,
      error: new Response("Missing TG_API_ID, TG_API_HASH or TG_SESSION Worker binding.", {
        status: 500
      })
    };
  }

  const client = new CoreTelegramClient({
    client: new CoreBaseTelegramClient({
      apiId,
      apiHash,
      storage: new MemoryStorage(),
      crypto: new WebCryptoProvider({
        wasmInput: mtcuteWasmModule
      }),
      transport: new WebSocketTransport(),
      platform: new WebPlatform(),
      updates: false,
      disableUpdates: true
    }),
    disableUpdates: true
  });

  try {
    await client.importSession(session);
  } catch (error) {
    console.error("Failed to import Telegram session:", error);
    await client.destroy();

    return {
      ok: false,
      error: new Response("TG_SESSION is invalid or cannot be imported.", {
        status: 400
      })
    };
  }

  return { ok: true, client };
}

function getCounterStub(env: Env) {
  const id = env.COUNTER.idFromName("global");
  return env.COUNTER.get(id);
}

async function getCounter(env: Env, key: CounterKey): Promise<number> {
  const stub = getCounterStub(env);
  const response = await stub.fetch(`https://counter/value?key=${encodeURIComponent(key)}`);

  if (!response.ok) {
    throw new Error(`Counter read failed with status ${response.status}`);
  }

  const data = (await response.json()) as CounterState;
  return data.count;
}

async function setCounter(env: Env, key: CounterKey, count: number): Promise<number> {
  const stub = getCounterStub(env);
  const response = await stub.fetch(`https://counter/set?key=${encodeURIComponent(key)}`, {
    method: "POST",
    body: JSON.stringify({ count } satisfies CounterState),
    headers: {
      "content-type": "application/json; charset=utf-8"
    }
  });

  if (!response.ok) {
    throw new Error(`Counter set failed with status ${response.status}`);
  }

  const data = (await response.json()) as CounterState;
  return data.count;
}

async function incrementCounter(env: Env, key: CounterKey): Promise<number> {
  const stub = getCounterStub(env);
  const response = await stub.fetch(`https://counter/increment?key=${encodeURIComponent(key)}`, {
    method: "POST"
  });

  if (!response.ok) {
    throw new Error(`Counter increment failed with status ${response.status}`);
  }

  const data = (await response.json()) as CounterState;
  return data.count;
}

async function getOptionalCounter(env: Env, key: CounterKey): Promise<number | null> {
  try {
    return await getCounter(env, key);
  } catch (error) {
    console.error(`Failed to read ${key} counter:`, error);
    return null;
  }
}

type RegexTarget = "name" | "memberTag";
type NameExtractSource = "first_name" | "last_name" | "full_name";

function getNameExtractSource(env: Env): NameExtractSource {
  const source = env.NAME_EXTRACT_SOURCE?.trim().toLowerCase();

  if (source === "first_name" || source === "last_name" || source === "full_name") {
    return source;
  }

  return "full_name";
}

function getNameSourceText(env: Env, firstName: string, lastName: string): string {
  const source = getNameExtractSource(env);

  if (source === "first_name") {
    return firstName;
  }

  if (source === "last_name") {
    return lastName;
  }

  return `${firstName}${lastName}`.trim();
}

function createExtractRegex(env: Env, target: RegexTarget): RegExp | null {
  const pattern = target === "name"
    ? env.NAME_EXTRACT_REGEX?.trim()
    : env.MEMBER_TAG_EXTRACT_REGEX?.trim();

  if (!pattern) {
    return null;
  }

  return new RegExp(pattern);
}

function extractFromText(env: Env, target: RegexTarget, source: string): string | null {
  const regex = createExtractRegex(env, target);

  if (!regex) {
    return null;
  }

  const match = regex.exec(source);

  if (!match) {
    return null;
  }

  return match[1] ?? match[0] ?? "";
}

function extractFromName(env: Env, firstName: string, lastName: string): string | null {
  return extractFromText(env, "name", getNameSourceText(env, firstName, lastName));
}

function getDigitStyleInfo(char: string): { kind: "range"; zeroCodePoint: number } | {
  kind: "superscript";
} | null {
  const codePoint = char.codePointAt(0);

  if (codePoint === undefined) {
    return null;
  }

  const superscriptDigits = "⁰¹²³⁴⁵⁶⁷⁸⁹";

  if (superscriptDigits.includes(char)) {
    return { kind: "superscript" };
  }

  const zeroCodePoints = [
    0x0660, 0x06f0, 0x07c0, 0x0966, 0x09e6, 0x0a66, 0x0ae6, 0x0b66, 0x0be6,
    0x0c66, 0x0ce6, 0x0d66, 0x0de6, 0x0e50, 0x0ed0, 0x0f20, 0x1040, 0x1090,
    0x17e0, 0x1810, 0x1946, 0x19d0, 0x1a80, 0x1a90, 0x1b50, 0x1bb0, 0x1c40,
    0x1c50, 0xa620, 0xa8d0, 0xa900, 0xa9d0, 0xa9f0, 0xaa50, 0xabf0, 0xff10
  ];

  for (const zeroCodePoint of zeroCodePoints) {
    const delta = codePoint - zeroCodePoint;

    if (delta >= 0 && delta <= 9) {
      return { kind: "range", zeroCodePoint };
    }
  }

  return null;
}

function normalizeUnicodeDigits(input: string): string {
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
      const delta = codePoint - styleInfo.zeroCodePoint;
      result += String(delta);
    }
  }

  return result;
}

function formatDigitsWithOriginalStyle(template: string, digits: string): string {
  const superscriptDigits = "⁰¹²³⁴⁵⁶⁷⁸⁹";
  const styleSample = [...template].find((char) => normalizeUnicodeDigits(char).length > 0);

  if (!styleSample) {
    return digits;
  }

  const styleInfo = getDigitStyleInfo(styleSample);

  if (!styleInfo) {
    return digits;
  }

  if (styleInfo.kind === "superscript") {
    return [...digits].map((digit) => superscriptDigits[Number(digit)]).join("");
  }

  let formatted = "";

  for (const digit of digits) {
    const codePoint = styleInfo.zeroCodePoint + Number(digit);
    formatted += String.fromCodePoint(codePoint);
  }

  return formatted;
}

function setTextValueFromCount(
  env: Env,
  target: RegexTarget,
  source: string,
  nextCount: number
): {
  value: string;
  extracted: string;
} | null {
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
  const end = start + extracted.length;
  const formattedCount = formatDigitsWithOriginalStyle(extracted, String(nextCount));

  return {
    value: `${source.slice(0, start)}${formattedCount}${source.slice(end)}`,
    extracted: formattedCount
  };
}

function setNameValueFromCount(
  env: Env,
  firstName: string,
  lastName: string,
  nextCount: number
): {
  firstName: string;
  lastName: string;
  extracted: string;
} | null {
  const regex = createExtractRegex(env, "name");
  const sourceType = getNameExtractSource(env);

  if (!regex) {
    return null;
  }

  const source = getNameSourceText(env, firstName, lastName);
  const match = regex.exec(source);

  if (!match) {
    return null;
  }

  const matchedText = match[0] ?? "";
  const extracted = match[1] ?? match[0] ?? "";
  const start = match.index + matchedText.indexOf(extracted);
  const end = start + extracted.length;
  const formattedCount = formatDigitsWithOriginalStyle(extracted, String(nextCount));

  if (sourceType === "first_name") {
    return {
      firstName: `${firstName.slice(0, start)}${formattedCount}${firstName.slice(end)}`,
      lastName,
      extracted: formattedCount
    };
  }

  if (sourceType === "last_name") {
    return {
      firstName,
      lastName: `${lastName.slice(0, start)}${formattedCount}${lastName.slice(end)}`,
      extracted: formattedCount
    };
  }

  const firstNameLength = firstName.length;

  if (start < firstNameLength && end > firstNameLength) {
    return null;
  }

  if (end <= firstNameLength) {
    return {
      firstName: `${firstName.slice(0, start)}${formattedCount}${firstName.slice(end)}`,
      lastName,
      extracted: formattedCount
    };
  }

  const localStart = start - firstNameLength;
  const localEnd = end - firstNameLength;

  return {
    firstName,
    lastName: `${lastName.slice(0, localStart)}${formattedCount}${lastName.slice(localEnd)}`,
    extracted: formattedCount
  };
}

async function syncCounterFromExtracted(env: Env, key: CounterKey, extracted: string): Promise<number | null> {
  const normalizedDigits = normalizeUnicodeDigits(extracted);

  if (!normalizedDigits) {
    return null;
  }

  return setCounter(env, key, Number(normalizedDigits));
}

type MemberTagState = {
  tag: string | null;
  count: number | null;
  extracted: string | null;
  error: string | null;
};

async function getMemberTagState(env: Env, client: MtcuteClient): Promise<MemberTagState> {
  const memberTagResult = await getCurrentMemberTag(env, client);
  const memberTag = memberTagResult.tag;

  if (!memberTag) {
    return {
      tag: null,
      count: await getOptionalCounter(env, "memberTag"),
      extracted: null,
      error: memberTagResult.error
    };
  }

  const extracted = extractFromText(env, "memberTag", memberTag);
  const count = extracted
    ? (await syncCounterFromExtracted(env, "memberTag", extracted)) ?? await getOptionalCounter(env, "memberTag")
    : await getOptionalCounter(env, "memberTag");

  return {
    tag: memberTag,
    count,
    extracted,
    error: memberTagResult.error
  };
}

async function updateCurrentMemberTag(
  env: Env,
  client: MtcuteClient,
  currentTag: string,
  nextCount: number
): Promise<{ tag: string; extracted: string } | { error: string }> {
  const groupId = env.TG_GROUP_ID?.trim();

  if (!groupId) {
    return { error: "TG_GROUP_ID is missing." };
  }

  const nextTag = setTextValueFromCount(env, "memberTag", currentTag, nextCount);

  if (!nextTag || !normalizeUnicodeDigits(nextTag.extracted)) {
    return { error: "Unable to bump member tag digits with the current regex." };
  }

  try {
    const resolvedGroupId = /^-?\d+$/.test(groupId) ? Number(groupId) : groupId;

    await client.editChatMemberRank({
      chatId: resolvedGroupId,
      participantId: "me",
      rank: nextTag.value
    });

    return {
      tag: nextTag.value,
      extracted: nextTag.extracted
    };
  } catch (error) {
    console.error("Failed to update current member tag:", error);
    const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    return { error: message };
  }
}

async function getCurrentResult(
  env: Env,
  client: MtcuteClient,
  firstName: string,
  lastName: string
): Promise<WorkerResponseBody | Response> {
  const extracted = extractFromName(env, firstName, lastName);
  const count = extracted
    ? (await syncCounterFromExtracted(env, "name", extracted)) ?? await getOptionalCounter(env, "name")
    : await getOptionalCounter(env, "name");
  const memberTagState = await getMemberTagState(env, client);

  return {
    count,
    extracted,
    memberTag: memberTagState.tag,
    memberTagCount: memberTagState.count,
    memberTagExtracted: memberTagState.extracted,
    memberTagError: memberTagState.error
  };
}

async function bumpProfileAndCounter(
  env: Env,
  client: MtcuteClient,
  firstName: string,
  lastName: string
): Promise<WorkerResponseBody | Response> {
  const currentNameValue = extractFromName(env, firstName, lastName);
  let count = await getOptionalCounter(env, "name");
  let extracted = currentNameValue;

  if (currentNameValue && normalizeUnicodeDigits(currentNameValue)) {
    const nextCount = await incrementCounter(env, "name");
    const nextName = setNameValueFromCount(env, firstName, lastName, nextCount);

    if (nextName !== null) {
      await client.updateProfile({
        firstName: nextName.firstName,
        lastName: nextName.lastName
      });

      count = nextCount;
      extracted = nextName.extracted;
    } else {
      await setCounter(env, "name", nextCount - 1);
    }
  }

  const memberTagState = await getMemberTagState(env, client);
  let memberTag = memberTagState.tag;
  let memberTagCount = memberTagState.count;
  let memberTagExtracted = memberTagState.extracted;
  let memberTagError = memberTagState.error;

  if (memberTagState.tag && memberTagState.extracted && normalizeUnicodeDigits(memberTagState.extracted)) {
    const nextMemberTagCount = await incrementCounter(env, "memberTag");
    const nextMemberTag = await updateCurrentMemberTag(env, client, memberTagState.tag, nextMemberTagCount);

    if ("error" in nextMemberTag) {
      await setCounter(env, "memberTag", nextMemberTagCount - 1);
      memberTagError = nextMemberTag.error;
    } else {
      memberTag = nextMemberTag.tag;
      memberTagCount = nextMemberTagCount;
      memberTagExtracted = nextMemberTag.extracted;
      memberTagError = null;
    }
  }

  return {
    count,
    extracted,
    memberTag,
    memberTagCount,
    memberTagExtracted,
    memberTagError
  };
}

async function getAuthorizedUser(client: MtcuteClient): Promise<Awaited<ReturnType<MtcuteClient["getMe"]>> | null> {
  try {
    return await client.getMe();
  } catch (error) {
    console.error("Failed to fetch current Telegram user:", error);
    return null;
  }
}

async function getCurrentMemberTag(
  env: Env,
  client: MtcuteClient
): Promise<{ tag: string | null; source: string | null; error: string | null }> {
  const groupId = env.TG_GROUP_ID?.trim();

  if (!groupId) {
    return { tag: null, source: null, error: "TG_GROUP_ID is missing." };
  }

  try {
    const resolvedGroupId = /^-?\d+$/.test(groupId) ? Number(groupId) : groupId;
    const member = await client.getChatMember({
      chatId: resolvedGroupId,
      userId: "me"
    });

    return {
      tag: member?.title?.trim() || null,
      source: null,
      error: null
    };
  } catch (error) {
    console.error("Failed to fetch current member tag:", error);
    const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    return { tag: null, source: null, error: message };
  }
}

async function runBump(env: Env): Promise<WorkerResponseBody | Response> {
  const clientResult = await createClient(env);

  if (!clientResult.ok) {
    return clientResult.error;
  }

  const { client } = clientResult;

  try {
    await client.connect();

    const me = await getAuthorizedUser(client);

    if (!me) {
      console.error("Worker failed: TG_SESSION is not authorized.");
      return new Response("TG_SESSION is not authorized.", { status: 401 });
    }

    return await bumpProfileAndCounter(env, client, me.firstName ?? "", me.lastName ?? "");
  } catch (error) {
    console.error("Worker failed:", error);
    return new Response("Failed to bump Telegram nickname. Check Worker logs.", {
      status: 500
    });
  } finally {
    await client.disconnect();
    await client.destroy();
  }
}

const fetchHandler: ExportedHandlerFetchHandler<Env> = async (
  request: Request,
  env: Env
): Promise<Response> => {
  const clientResult = await createClient(env);

  if (!clientResult.ok) {
    return clientResult.error;
  }

  const { client } = clientResult;

  let response: Response;

  try {
    await client.connect();

    const me = await getAuthorizedUser(client);

    if (!me) {
      console.error("Worker failed: TG_SESSION is not authorized.");
      response = new Response("TG_SESSION is not authorized.", { status: 401 });
      return response;
    }

    const url = new URL(request.url);
    let result: WorkerResponseBody | Response;

    if (request.method === "POST" && url.pathname === "/bump") {
      result = await bumpProfileAndCounter(env, client, me.firstName ?? "", me.lastName ?? "");
    } else {
      result = await getCurrentResult(env, client, me.firstName ?? "", me.lastName ?? "");
    }

    if (result instanceof Response) {
      return result;
    }

    console.log("Worker result:", result);

    response = new Response(JSON.stringify(result, null, 2), {
      headers: {
        "content-type": "application/json; charset=utf-8"
      }
    });
    return response;
  } catch (error) {
    console.error("Worker failed:", error);
    response = new Response("Failed to fetch Telegram user info. Check Worker logs.", {
      status: 500
    });
    return response;
  } finally {
    await client.disconnect();
    await client.destroy();
  }
};

const scheduledHandler: ExportedHandlerScheduledHandler<Env> = async (
  controller: ScheduledController,
  env: Env,
  _ctx: ExecutionContext
): Promise<void> => {
  const result = await runBump(env);

  if (result instanceof Response) {
    console.error("Scheduled bump failed:", {
      cron: controller.cron,
      status: result.status
    });
    return;
  }

  console.log("Scheduled bump succeeded:", {
    cron: controller.cron,
    count: result.count,
    extracted: result.extracted
  });
};

const worker: ExportedHandler<Env> = {
  fetch: fetchHandler,
  scheduled: scheduledHandler
};

export default worker;

export class Counter {
  constructor(private readonly state: DurableObjectState) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const key = url.searchParams.get("key")?.trim() || "name";
    const storageKey = `count:${key}`;

    if (request.method === "GET" && url.pathname === "/value") {
      const count = (await this.state.storage.get<number>(storageKey)) ?? 0;
      return Response.json({ count } satisfies CounterState);
    }

    if (request.method === "POST" && url.pathname === "/set") {
      const payload = (await request.json()) as Partial<CounterState>;
      const nextCount = payload.count;

      if (typeof nextCount !== "number" || !Number.isInteger(nextCount) || nextCount < 0) {
        return new Response("Invalid counter value.", { status: 400 });
      }

      await this.state.storage.put(storageKey, nextCount);

      return Response.json({ count: nextCount } satisfies CounterState);
    }

    if (request.method === "POST" && url.pathname === "/increment") {
      const current = (await this.state.storage.get<number>(storageKey)) ?? 0;
      const count = current + 1;

      await this.state.storage.put(storageKey, count);

      return Response.json({ count } satisfies CounterState);
    }

    return new Response("Method Not Allowed", { status: 405 });
  }
}
