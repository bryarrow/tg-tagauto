/// <reference types="@cloudflare/workers-types" />

import { Buffer as BufferPolyfill } from "buffer";
import type { TelegramClient as GramJsClient } from "telegram";

interface Env {
  TG_API_ID: string;
  TG_API_HASH: string;
  TG_SESSION: string;
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

const fetchHandler: ExportedHandlerFetchHandler<Env> = async (
  _request: Request,
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

    const userInfo = {
      id: me.id.toString(),
      firstName: me.firstName ?? "",
      lastName: me.lastName ?? "",
      username: me.username ?? "",
      phone: me.phone ?? "",
      premium: Boolean(me.premium),
      bot: Boolean(me.bot)
    };

    console.log("Logged in user:", userInfo);

    response = new Response(JSON.stringify(userInfo, null, 2), {
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
