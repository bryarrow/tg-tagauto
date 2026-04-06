/// <reference types="@cloudflare/workers-types" />

import { getOptionalCounter, incrementCounter, setCounter } from "./counter";
import { normalizeUnicodeDigits } from "./digits";
import { extractFromName, extractFromText, replaceMatchedDigits, replaceNameDigits } from "./extract";
import { createClient, getAuthorizedUser, getCurrentMemberTag, MtcuteClient, updateCurrentMemberTag } from "./telegram";
import { CounterKey, CounterState, Env, MemberTagState, WorkerResponseBody } from "./types";

async function syncCounterFromExtracted(env: Env, key: CounterKey, extracted: string): Promise<number | null> {
  const normalizedDigits = normalizeUnicodeDigits(extracted);

  if (!normalizedDigits) {
    return null;
  }

  return setCounter(env, key, Number(normalizedDigits));
}

async function getMemberTagState(env: Env, client: MtcuteClient): Promise<MemberTagState> {
  const { tag, error } = await getCurrentMemberTag(env, client);

  if (!tag) {
    return {
      tag: null,
      count: await getOptionalCounter(env, "memberTag"),
      extracted: null,
      error
    };
  }

  const extracted = extractFromText(env, "memberTag", tag);
  const count = extracted
    ? (await syncCounterFromExtracted(env, "memberTag", extracted)) ?? await getOptionalCounter(env, "memberTag")
    : await getOptionalCounter(env, "memberTag");

  return {
    tag,
    count,
    extracted,
    error
  };
}

async function getCurrentResult(
  env: Env,
  client: MtcuteClient,
  firstName: string,
  lastName: string
): Promise<WorkerResponseBody> {
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
): Promise<WorkerResponseBody> {
  const currentNameValue = extractFromName(env, firstName, lastName);
  let count = await getOptionalCounter(env, "name");
  let extracted = currentNameValue;

  if (currentNameValue && normalizeUnicodeDigits(currentNameValue)) {
    const nextCount = await incrementCounter(env, "name");
    const nextName = replaceNameDigits(env, firstName, lastName, nextCount);

    if (nextName) {
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
    const nextTag = replaceMatchedDigits(env, "memberTag", memberTagState.tag, nextMemberTagCount);

    if (!nextTag || !normalizeUnicodeDigits(nextTag.extracted)) {
      await setCounter(env, "memberTag", nextMemberTagCount - 1);
      memberTagError = "Unable to bump member tag digits with the current regex.";
    } else {
      const updateResult = await updateCurrentMemberTag(env, client, nextTag.value);

      if (!updateResult.ok) {
        await setCounter(env, "memberTag", nextMemberTagCount - 1);
        memberTagError = updateResult.error;
      } else {
        memberTag = updateResult.tag;
        memberTagCount = nextMemberTagCount;
        memberTagExtracted = nextTag.extracted;
        memberTagError = null;
      }
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

async function withTelegramClient<T>(
  env: Env,
  action: (client: MtcuteClient, me: NonNullable<Awaited<ReturnType<typeof getAuthorizedUser>>>) => Promise<T>
): Promise<T | Response> {
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

    return await action(client, me);
  } finally {
    await client.disconnect();
    await client.destroy();
  }
}

async function runBump(env: Env): Promise<WorkerResponseBody | Response> {
  try {
    return await withTelegramClient(env, (client, me) => {
      return bumpProfileAndCounter(env, client, me.firstName ?? "", me.lastName ?? "");
    });
  } catch (error) {
    console.error("Worker failed:", error);
    return new Response("Failed to bump Telegram nickname. Check Worker logs.", {
      status: 500
    });
  }
}

const fetchHandler: ExportedHandlerFetchHandler<Env> = async (request, env): Promise<Response> => {
  try {
    const url = new URL(request.url);
    const result = await withTelegramClient(env, (client, me) => {
      if (request.method === "POST" && url.pathname === "/bump") {
        return bumpProfileAndCounter(env, client, me.firstName ?? "", me.lastName ?? "");
      }

      return getCurrentResult(env, client, me.firstName ?? "", me.lastName ?? "");
    });

    if (result instanceof Response) {
      return result;
    }

    console.log("Worker result:", result);

    return new Response(JSON.stringify(result, null, 2), {
      headers: {
        "content-type": "application/json; charset=utf-8"
      }
    });
  } catch (error) {
    console.error("Worker failed:", error);
    return new Response("Failed to fetch Telegram user info. Check Worker logs.", {
      status: 500
    });
  }
};

const scheduledHandler: ExportedHandlerScheduledHandler<Env> = async (controller, env): Promise<void> => {
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
