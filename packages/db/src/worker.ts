import { retryDelayMs } from "@collective/domain";

import type { PrismaClient } from "./client.js";
import {
  claimJob,
  claimOutbox,
  finishJob,
  finishOutbox,
  type ClaimedWork,
} from "./platform.js";

export interface WorkHandler {
  (work: ClaimedWork): Promise<void>;
}

export async function runJobOnce(
  db: PrismaClient,
  handlers: ReadonlyMap<string, WorkHandler>,
  options: { owner: string; now: Date; leaseMs: number; delayMs?: (attempt: number) => number },
) {
  const claimed = await claimJob(db, options.owner, options.now, options.leaseMs);
  if (!claimed) {
    return { claimed: false as const };
  }
  return { claimed: true as const, outcome: await settle(db, claimed, handlers, options, "job") };
}

export async function runOutboxOnce(
  db: PrismaClient,
  handlers: ReadonlyMap<string, WorkHandler>,
  options: { owner: string; now: Date; leaseMs: number; delayMs?: (attempt: number) => number },
) {
  const claimed = await claimOutbox(db, options.owner, options.now, options.leaseMs);
  if (!claimed) {
    return { claimed: false as const };
  }
  return { claimed: true as const, outcome: await settle(db, claimed, handlers, options, "outbox") };
}

async function settle(
  db: PrismaClient,
  claimed: ClaimedWork,
  handlers: ReadonlyMap<string, WorkHandler>,
  options: { now: Date; delayMs?: (attempt: number) => number },
  kind: "job" | "outbox",
) {
  const delay = options.delayMs ?? retryDelayMs;
  const handler = handlers.get(claimed.type);
  try {
    if (!handler) {
      throw new Error(`No handler for ${claimed.type}.`);
    }
    await handler(claimed);
    if (kind === "job") {
      return finishJob(db, claimed, { ok: true });
    }
    return finishOutbox(db, claimed, { ok: true, deliveredAt: options.now });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Work failed.";
    const retryAt = claimed.attempts >= claimed.maxAttempts ? null : new Date(options.now.getTime() + delay(claimed.attempts));
    if (kind === "job") {
      return finishJob(db, claimed, { ok: false, error: message, retryAt });
    }
    return finishOutbox(db, claimed, { ok: false, error: message, retryAt });
  }
}

export function startWorkLoop(input: {
  run: () => Promise<void>;
  intervalMs: number;
  log: (message: string) => void;
}): { stop: () => void } {
  let stopped = false;
  const tick = () => {
    if (stopped) {
      return;
    }
    void input.run().catch((error: unknown) => {
      input.log(error instanceof Error ? error.message : "Work loop failed.");
    });
  };
  const timer = setInterval(tick, input.intervalMs);
  timer.unref?.();
  tick();
  return {
    stop: () => {
      stopped = true;
      clearInterval(timer);
    },
  };
}
