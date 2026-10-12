export type SessionRejection = "actor" | "expired" | "stale" | "consumed";

export function evaluateSession(
  session: {
    actorUserId: string;
    revision: number;
    expiresAt: Date;
    consumedAt: Date | null;
  },
  actorUserId: string,
  activeRevision: number,
  now: Date,
): "ok" | SessionRejection {
  if (session.actorUserId !== actorUserId) {
    return "actor";
  }
  if (session.consumedAt) {
    return "consumed";
  }
  if (session.expiresAt.getTime() <= now.getTime()) {
    return "expired";
  }
  if (session.revision !== activeRevision) {
    return "stale";
  }
  return "ok";
}

export function retryDelayMs(attempt: number): number {
  const delay = 1000 * 2 ** Math.max(0, attempt - 1);
  return Math.min(delay, 15 * 60 * 1000);
}
