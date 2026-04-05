import readline from "readline/promises";
import { stdin, stdout } from "process";

import dotenv from "dotenv";
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";

dotenv.config();

const apiId = Number(process.env.TG_API_ID);
const apiHash = process.env.TG_API_HASH;
const savedSession = (process.env.TG_SESSION ?? "").trim();

if (!apiId || !apiHash) {
  console.error("Missing TG_API_ID or TG_API_HASH. Please check your .env file.");
  process.exit(1);
}

const telegramApiHash = apiHash;

async function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({ input: stdin, output: stdout });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

async function main(): Promise<void> {
  const stringSession = new StringSession(savedSession);
  const client = new TelegramClient(stringSession, apiId, telegramApiHash, {
    connectionRetries: 5
  });

  try {
    await client.start({
      phoneNumber: async () => prompt("Phone number (e.g. +8613800000000): "),
      password: async () => prompt("2FA password (leave empty if not enabled): "),
      phoneCode: async () => prompt("Login code: "),
      onError: (error: Error) => {
        console.error("Login failed:", error.message || error);
      }
    });

    console.log("Copy this into Cloudflare Worker secret TG_SESSION:");
    console.log(stringSession.save());
  } finally {
    await client.disconnect();
  }
}

void main().catch((error: unknown) => {
  console.error("Unexpected error:", error);
  process.exit(1);
});
