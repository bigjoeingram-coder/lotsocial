import { database, ensureLotSocialSchema } from "./schema-bootstrap.ts";
import type { LotSocialEnvironment } from "./schema-bootstrap.ts";

export type ImportOutcome = {
  associateEmail: string;
  sourceHost: string;
  outcome: string;
  elapsedMs: number;
  fallback: string;
  brightDataUsed: boolean;
  notice?: string;
};

export async function writeImportOutcome(input: ImportOutcome, env: LotSocialEnvironment) {
  await ensureLotSocialSchema(env);
  await database(env, "import telemetry").prepare(`INSERT INTO import_outcomes (
    id, associate_email, source_host, outcome, elapsed_ms, fallback, bright_data_used, notice
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(
      crypto.randomUUID(),
      input.associateEmail.trim().toLowerCase(),
      input.sourceHost.trim().toLowerCase() || "invalid-url",
      input.outcome,
      Math.max(0, Math.round(input.elapsedMs)),
      input.fallback || "none",
      input.brightDataUsed ? 1 : 0,
      input.notice ?? "",
    ).run();
}

export async function importHealth(env: LotSocialEnvironment) {
  await ensureLotSocialSchema(env);
  const db = database(env, "import telemetry");
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const byHost = await db.prepare(`SELECT source_host,
      COUNT(*) AS attempts,
      SUM(CASE WHEN outcome LIKE '%success' OR outcome = 'reused' THEN 1 ELSE 0 END) AS successes,
      SUM(bright_data_used) AS bright_data_uses
    FROM import_outcomes WHERE datetime(created_at) >= datetime(?)
    GROUP BY source_host ORDER BY attempts DESC, source_host ASC`).bind(cutoff).all<{
      source_host: string;
      attempts: number;
      successes: number;
      bright_data_uses: number;
    }>();
  return byHost.results.map((row) => ({
    host: row.source_host,
    attempts: Number(row.attempts),
    successes: Number(row.successes),
    successRate: Number(row.attempts) > 0 ? Number(row.successes) / Number(row.attempts) : 0,
    brightDataUses: Number(row.bright_data_uses),
  }));
}

export function secureEqual(left: string, right: string) {
  const a = new TextEncoder().encode(left);
  const b = new TextEncoder().encode(right);
  let difference = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) difference |= (a[index] ?? 0) ^ (b[index] ?? 0);
  return difference === 0;
}
