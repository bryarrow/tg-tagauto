/// <reference types="@cloudflare/workers-types" />

import { Buffer as BufferPolyfill } from "buffer";
import type { TelegramClient as GramJsClient } from "telegram";

interface Env {
  TG_API_ID: string;
  TG_API_HASH: string;
  TG_SESSION: string;
  NAME_EXTRACT_REGEX: string;
  COUNTER: DurableObjectNamespace;
}

interface WorkerShimWindow {
  location?: {
    protocol?: string;
  };
  addEventListener?: (_type: string, _listener: EventListenerOrEventListenerObject) => void;
  removeEventListener?: (_type: string, _listener: EventListenerOrEventListenerObject) => void;
}

type CreateClientResult =
  | { ok: false; error: Response }
  | {
      ok: true;
      client: GramJsClient;
      Api: typeof import("telegram").Api;
    };

interface CounterState {
  count: number;
}

interface WorkerResponseBody {
  count: number;
  extracted: string;
}

function ensureWorkerShims(): void {
  const runtime = globalThis as typeof globalThis & {
    Buffer?: typeof BufferPolyfill;
  };
  const bag = globalThis as Record<string, unknown>;

  if (!runtime.Buffer) {
    runtime.Buffer = BufferPolyfill;
  }

  let shimWindow = bag.window as WorkerShimWindow | undefined;

  if (!shimWindow) {
    shimWindow = {};
    Object.defineProperty(globalThis, "window", {
      value: shimWindow,
      configurable: true,
      writable: true
    });
  }

  const location = shimWindow.location ?? (shimWindow.location = {});

  if (!location.protocol) {
    location.protocol = "https:";
  }

  if (typeof shimWindow.addEventListener !== "function") {
    shimWindow.addEventListener = () => undefined;
  }

  if (typeof shimWindow.removeEventListener !== "function") {
    shimWindow.removeEventListener = () => undefined;
  }
}

async function createClient(env: Env): Promise<CreateClientResult> {
  const { TelegramClient, Api } = await import("telegram");
  const { StringSession } = await import("telegram/sessions");

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

  const client = new TelegramClient(new StringSession(session), apiId, apiHash, {
    connectionRetries: 5,
    useWSS: true
  });

  if (client.session.dcId) {
    const webDc = await client.getDC(client.session.dcId, false, true);
    client.session.setDC(webDc.id, webDc.ipAddress, webDc.port);
  }

  return { ok: true, client, Api };
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
    method: "POST",
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

  return {
    count,
    extracted
  };
}

async function bumpProfileAndCounter(
  env: Env,
  client: GramJsClient,
  Api: typeof import("telegram").Api,
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

  await client.invoke(
    new Api.account.UpdateProfile({
      firstName: nextName.firstName,
      lastName: nextName.lastName
    })
  );

  return {
    count,
    extracted: nextName.extracted
  };
}

const fetchHandler: ExportedHandlerFetchHandler<Env> = async (
  request: Request,
  env: Env
): Promise<Response> => {
  ensureWorkerShims();

  const clientResult = await createClient(env);

  if (!clientResult.ok) {
    return clientResult.error;
  }

  const { client, Api } = clientResult;

  let response: Response;

  try {
    await client.connect();

    if (!(await client.isUserAuthorized())) {
      console.error("Worker failed: TG_SESSION is not authorized.");
      response = new Response("TG_SESSION is not authorized.", { status: 401 });
      return response;
    }

    const me = await client.getMe();

    if (!(me instanceof Api.User)) {
      console.error("Worker failed: session does not belong to a Telegram user account.");
      response = new Response("The session does not belong to a Telegram user account.", {
        status: 400
      });
      return response;
    }

    const url = new URL(request.url);
    let result: WorkerResponseBody | Response;

    if (request.method === "POST" && url.pathname === "/bump") {
      result = await bumpProfileAndCounter(env, client, Api, me.firstName ?? "", me.lastName ?? "");
    } else {
      result = await getCurrentResult(env, me.firstName ?? "", me.lastName ?? "");
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
  }
};

const worker: ExportedHandler<Env> = {
  fetch: fetchHandler
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
