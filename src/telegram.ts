/// <reference path="./wasm.d.ts" />

import mtcuteWasmModule from "@mtcute/wasm/mtcute.wasm";
import { BaseTelegramClient as CoreBaseTelegramClient, TelegramClient as CoreTelegramClient } from "@mtcute/core/client.js";
import { MemoryStorage, WebCryptoProvider, WebPlatform, WebSocketTransport } from "@mtcute/web";
import { getGroupId } from "./config";
import { Env } from "./types";

export type MtcuteClient = CoreTelegramClient;

export type CreateClientResult =
  | { ok: false; error: Response }
  | { ok: true; client: MtcuteClient };

export async function createClient(env: Env): Promise<CreateClientResult> {
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

export async function getAuthorizedUser(client: MtcuteClient): Promise<Awaited<ReturnType<MtcuteClient["getMe"]>> | null> {
  try {
    return await client.getMe();
  } catch (error) {
    console.error("Failed to fetch current Telegram user:", error);
    return null;
  }
}

export async function getCurrentMemberTag(
  env: Env,
  client: MtcuteClient
): Promise<{ tag: string | null; error: string | null }> {
  const groupId = getGroupId(env);

  if (groupId === null) {
    return { tag: null, error: "TG_GROUP_ID is missing." };
  }

  try {
    const member = await client.getChatMember({
      chatId: groupId,
      userId: "me"
    });

    return {
      tag: member?.title?.trim() || null,
      error: null
    };
  } catch (error) {
    console.error("Failed to fetch current member tag:", error);
    const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);

    return { tag: null, error: message };
  }
}

export async function updateCurrentMemberTag(
  env: Env,
  client: MtcuteClient,
  rank: string
): Promise<{ ok: true; tag: string } | { ok: false; error: string }> {
  const groupId = getGroupId(env);

  if (groupId === null) {
    return { ok: false, error: "TG_GROUP_ID is missing." };
  }

  try {
    await client.editChatMemberRank({
      chatId: groupId,
      participantId: "me",
      rank
    });

    return { ok: true, tag: rank };
  } catch (error) {
    console.error("Failed to update current member tag:", error);
    const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);

    return { ok: false, error: message };
  }
}
