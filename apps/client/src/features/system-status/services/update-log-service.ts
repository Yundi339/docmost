import { z } from "zod/v4";
import { IUpdateLog } from "@/features/system-status/types/update-log.types";

const updateLogChangeSchema = z
  .object({
    type: z.enum(["added", "improved", "fixed", "security"]),
    text: z.string().trim().min(1).max(500),
  })
  .strict();

const updateLogReleaseSchema = z
  .object({
    version: z.string().regex(/^\d{2}\.\d{2}\.\d{2}\.\d+$/),
    date: z.iso.date(),
    title: z.string().trim().min(1).max(100),
    changes: z.array(updateLogChangeSchema).min(1).max(30),
  })
  .strict();

const updateLogSchema = z
  .object({
    schemaVersion: z.literal(1),
    updatedAt: z.iso.datetime({ offset: true }),
    releases: z.array(updateLogReleaseSchema).max(50),
  })
  .strict();

export function parseUpdateLog(input: unknown): IUpdateLog {
  const log = updateLogSchema.parse(input);

  return {
    ...log,
    releases: [...log.releases].sort(
      (a, b) =>
        b.date.localeCompare(a.date) || b.version.localeCompare(a.version),
    ),
  };
}

export async function getUpdateLog(): Promise<IUpdateLog> {
  const response = await fetch("/updatelog/log.json", {
    cache: "no-store",
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    throw new Error(`Failed to load update log: ${response.status}`);
  }

  return parseUpdateLog(await response.json());
}
