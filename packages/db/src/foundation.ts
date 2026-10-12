import { FOUNDATION_RECORD_ID, FOUNDATION_REVISION } from "@collective/domain";

import type { PrismaClient } from "./client.js";

export class FoundationRevisionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FoundationRevisionError";
  }
}

export async function readFoundationRevision(prisma: PrismaClient): Promise<string> {
  const row = await prisma.foundationRevision.findUnique({
    where: { id: FOUNDATION_RECORD_ID },
  });
  if (!row || row.revision !== FOUNDATION_REVISION) {
    throw new FoundationRevisionError(
      `Database foundation revision is ${row?.revision ?? "missing"}; expected ${FOUNDATION_REVISION}. Apply migrations before starting.`,
    );
  }
  return row.revision;
}
