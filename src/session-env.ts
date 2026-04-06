import { readFile, writeFile } from "node:fs/promises";

const ENV_PATH = ".env";

function escapeEnvValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\n/g, "\\n");
}

export async function persistSessionToEnv(session: string): Promise<void> {
  const nextLine = `TG_SESSION=${escapeEnvValue(session)}`;
  let content = "";

  try {
    content = await readFile(ENV_PATH, "utf8");
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;

    if (nodeError.code !== "ENOENT") {
      throw error;
    }
  }

  if (!content) {
    await writeFile(ENV_PATH, `${nextLine}\n`, "utf8");
    return;
  }

  const tgSessionPattern = /^TG_SESSION=.*$/m;
  const nextContent = tgSessionPattern.test(content)
    ? content.replace(tgSessionPattern, nextLine)
    : `${content.trimEnd()}\n${nextLine}\n`;

  await writeFile(ENV_PATH, nextContent, "utf8");
}
