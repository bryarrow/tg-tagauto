import { CounterKey, CounterState, Env } from "./types";

function getCounterStub(env: Env) {
  const id = env.COUNTER.idFromName("global");
  return env.COUNTER.get(id);
}

async function callCounter(env: Env, path: string, init?: RequestInit): Promise<CounterState> {
  const response = await getCounterStub(env).fetch(`https://counter${path}`, init);

  if (!response.ok) {
    throw new Error(`Counter request failed with status ${response.status}`);
  }

  return (await response.json()) as CounterState;
}

export async function getCounter(env: Env, key: CounterKey): Promise<number> {
  const data = await callCounter(env, `/value?key=${encodeURIComponent(key)}`);
  return data.count;
}

export async function setCounter(env: Env, key: CounterKey, count: number): Promise<number> {
  const data = await callCounter(env, `/set?key=${encodeURIComponent(key)}`, {
    method: "POST",
    body: JSON.stringify({ count } satisfies CounterState),
    headers: {
      "content-type": "application/json; charset=utf-8"
    }
  });

  return data.count;
}

export async function incrementCounter(env: Env, key: CounterKey): Promise<number> {
  const data = await callCounter(env, `/increment?key=${encodeURIComponent(key)}`, {
    method: "POST"
  });

  return data.count;
}

export async function getOptionalCounter(env: Env, key: CounterKey): Promise<number | null> {
  try {
    return await getCounter(env, key);
  } catch (error) {
    console.error(`Failed to read ${key} counter:`, error);
    return null;
  }
}
