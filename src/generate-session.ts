import { readFile, writeFile } from "node:fs/promises";
import dotenv from "dotenv";
import { convertFromGramjsSession } from "@mtcute/convert";
import { TelegramClient } from "@mtcute/node";

dotenv.config();

const apiId = Number(process.env.TG_API_ID);
const apiHash = process.env.TG_API_HASH?.trim();
const savedSession = (process.env.TG_SESSION ?? "").trim();

if (!apiId || !apiHash) {
  console.error("Missing TG_API_ID or TG_API_HASH. Please check your .env file.");
  process.exit(1);
}

const requiredApiHash: string = apiHash;

function escapeEnvValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\n/g, "\\n");
}

async function persistSessionToEnv(session: string): Promise<void> {
  const envPath = ".env";
  const nextLine = `TG_SESSION=${escapeEnvValue(session)}`;
  let content = "";

  try {
    content = await readFile(envPath, "utf8");
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;

    if (nodeError.code !== "ENOENT") {
      throw error;
    }
  }

  if (!content) {
    await writeFile(envPath, `${nextLine}\n`, "utf8");
    return;
  }

  const tgSessionPattern = /^TG_SESSION=.*$/m;
  const nextContent = tgSessionPattern.test(content)
    ? content.replace(tgSessionPattern, nextLine)
    : `${content.trimEnd()}\n${nextLine}\n`;

  await writeFile(envPath, nextContent, "utf8");
}

async function importSessionWithFallback(client: TelegramClient, session: string): Promise<void> {
  try {
    await client.importSession(session);
    return;
  } catch {
    await client.importSession(convertFromGramjsSession(session), true);
  }
}

async function main(): Promise<void> {
  const client = new TelegramClient({
    apiId,
    apiHash: requiredApiHash,
    storage: ":memory:"
  });

  try {
    if (savedSession) {
      await importSessionWithFallback(client, savedSession);
    }

    const me = await client.start({
      phone: async () => client.input("Phone number (e.g. +8613800000000): "),
      password: async () => client.input("2FA password (leave empty if not enabled): "),
      code: async () => client.input("Login code: "),
      invalidCodeCallback: async (type) => {
        console.error(`${type} is invalid, please try again.`);
      }
    });

    const exportedSession = await client.exportSession();

    await persistSessionToEnv(exportedSession);
    process.env.TG_SESSION = exportedSession;

    console.log(`Logged in as ${me.displayName}`);
    console.log("Updated .env with the mtcute-native TG_SESSION.");
    console.log("Copy this into Cloudflare Worker secret TG_SESSION:");
    console.log(exportedSession);
  } finally {
    await client.disconnect();
    await client.destroy();
  }
}

void main().catch((error: unknown) => {
  console.error("Unexpected error:", error);
  process.exit(1);
});
