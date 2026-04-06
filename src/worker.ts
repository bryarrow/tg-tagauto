/// <reference types="@cloudflare/workers-types" />
/// <reference path="./wasm.d.ts" />

import mtcuteWasmModule from "@mtcute/wasm/mtcute.wasm";
import { BaseTelegramClient as CoreBaseTelegramClient, TelegramClient as CoreTelegramClient } from "@mtcute/core/client.js";
import { MemoryStorage, WebCryptoProvider, WebPlatform, WebSocketTransport } from "@mtcute/web";

interface Env {
  TG_API_ID: string;
  TG_API_HASH: string;
  TG_SESSION: string;
  NAME_EXTRACT_REGEX: string;
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

interface WorkerResponseBody {
  count: number;
  extracted: string;
  memberTag: string | null;
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

async function getCounter(env: Env): Promise<number> {
  const id = env.COUNTER.idFromName("global");
  const stub = env.COUNTER.get(id);
  const response = await stub.fetch("https://counter/value");

  if (!response.ok) {
    throw new Error(`Counter read failed with status ${response.status}`);
  }

  const data = (await response.json()) as CounterState;
  return data.count;
}

async function setCounter(env: Env, count: number): Promise<number> {
  const id = env.COUNTER.idFromName("global");
  const stub = env.COUNTER.get(id);
  const response = await stub.fetch("https://counter/set", {
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

async function incrementCounter(env: Env): Promise<number> {
  const id = env.COUNTER.idFromName("global");
  const stub = env.COUNTER.get(id);
  const response = await stub.fetch("https://counter/increment", {
    method: "POST"
  });

  if (!response.ok) {
    throw new Error(`Counter increment failed with status ${response.status}`);
  }

  const data = (await response.json()) as CounterState;
  return data.count;
}

function createNameRegex(env: Env): RegExp | null {
  const pattern = env.NAME_EXTRACT_REGEX?.trim();

  if (!pattern) {
    return null;
  }

  return new RegExp(pattern);
}

function extractFromName(env: Env, firstName: string, lastName: string): string | null {
  const source = `${firstName}${lastName}`.trim();
  const regex = createNameRegex(env);

  if (!regex) {
    return null;
  }

  const match = regex.exec(source);

  if (!match) {
    return "";
  }

  return match[1] ?? match[0] ?? "";
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
  const regex = createNameRegex(env);

  if (!regex) {
    return null;
  }

  const source = `${firstName}${lastName}`;
  const match = regex.exec(source);

  if (!match) {
    return null;
  }

  const extracted = match[1] ?? match[0] ?? "";
  const matchedText = match[0] ?? "";
  const start = match.index + matchedText.indexOf(extracted);
  const end = start + extracted.length;
  const firstNameLength = firstName.length;
  const formattedCount = formatDigitsWithOriginalStyle(extracted, String(nextCount));

  if (start < firstNameLength && end > firstNameLength) {
    return null;
  }

  if (end <= firstNameLength) {
    const nextFirstName = `${firstName.slice(0, start)}${formattedCount}${firstName.slice(end)}`;
    return {
      firstName: nextFirstName,
      lastName,
      extracted: formattedCount
    };
  }

  const localStart = start - firstNameLength;
  const localEnd = end - firstNameLength;
  const nextLastName = `${lastName.slice(0, localStart)}${formattedCount}${lastName.slice(localEnd)}`;

  return {
    firstName,
    lastName: nextLastName,
    extracted: formattedCount
  };
}

async function getCurrentResult(
  env: Env,
  client: MtcuteClient,
  firstName: string,
  lastName: string
): Promise<WorkerResponseBody | Response> {
  const extracted = extractFromName(env, firstName, lastName);

  if (extracted === null) {
    return new Response("NAME_EXTRACT_REGEX is missing.", { status: 500 });
  }

  const normalizedDigits = normalizeUnicodeDigits(extracted);

  if (!normalizedDigits) {
    return new Response("Extracted text does not contain a supported Unicode number.", {
      status: 400
    });
  }

  const count = await setCounter(env, Number(normalizedDigits));
  const {
    tag: memberTag
  } = await getCurrentMemberTag(env, client);

  return {
    count,
    extracted,
    memberTag
  };
}

async function bumpProfileAndCounter(
  env: Env,
  client: MtcuteClient,
  firstName: string,
  lastName: string
): Promise<WorkerResponseBody | Response> {
  const currentNameValue = extractFromName(env, firstName, lastName);

  if (currentNameValue === null) {
    return new Response("NAME_EXTRACT_REGEX is missing.", { status: 500 });
  }

  if (!normalizeUnicodeDigits(currentNameValue)) {
    return new Response("Unable to bump nickname digits with the current regex.", {
      status: 400
    });
  }

  const count = await incrementCounter(env);
  const nextName = setNameValueFromCount(env, firstName, lastName, count);

  if (nextName === null) {
    await setCounter(env, count - 1);
    return new Response("Unable to bump nickname digits with the current regex.", {
      status: 400
    });
  }

  await client.updateProfile({
    firstName: nextName.firstName,
    lastName: nextName.lastName
  });

  const {
    tag: memberTag
  } = await getCurrentMemberTag(env, client);

  return {
    count,
    extracted: nextName.extracted,
    memberTag
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

    if (request.method === "GET" && url.pathname === "/value") {
      const count = (await this.state.storage.get<number>("count")) ?? 0;
      return Response.json({ count } satisfies CounterState);
    }

    if (request.method === "POST" && url.pathname === "/set") {
      const payload = (await request.json()) as Partial<CounterState>;
      const nextCount = payload.count;

      if (typeof nextCount !== "number" || !Number.isInteger(nextCount) || nextCount < 0) {
        return new Response("Invalid counter value.", { status: 400 });
      }

      await this.state.storage.put("count", nextCount);

      return Response.json({ count: nextCount } satisfies CounterState);
    }

    if (request.method === "POST" && url.pathname === "/increment") {
      const current = (await this.state.storage.get<number>("count")) ?? 0;
      const count = current + 1;

      await this.state.storage.put("count", count);

      return Response.json({ count } satisfies CounterState);
    }

    return new Response("Method Not Allowed", { status: 405 });
  }
}
