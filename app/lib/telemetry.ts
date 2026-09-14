import { database, ensureLotSocialSchema } from "./schema-bootstrap.ts";
import type { LotSocialEnvironment } from "./schema-bootstrap.ts";
import { incrementDailyLimit } from "./limits.ts";

export type ImportOutcomeName =
  | "direct_success"
  | "brightdata_success"
  | "listing_guess_success"
  | "skipped_budget"
  | "network_timeout"
  | "parse_failure"
  | "reused"
  | "rate_limited";

export type ImportTelemetry = {
  outcome: ImportOutcomeName;
  fallback: string;
  brightDataUsed: boolean;
  budgetSkipped?: boolean;
  notice?: string;
};

export async function recordImportOutcome(env: LotSocialEnvironment, input: {
  associateEmail: string;
  sourceHost: string;
  outcome: ImportOutcomeName;
  elapsedMs: number;
  fallback: string;
  brightDataUsed: boolean;
}) {
  await ensureLotSocialSchema(env);
  await database(env, "import telemetry").prepare(`INSERT INTO import_outcomes (
    id, associate_email, source_host, outcome, elapsed_ms, fallback, bright_data_used
  ) VALUES (?, ?, ?, ?, ?, ?, ?)`).bind(
    crypto.randomUUID(), input.associateEmail.toLowerCase(), input.sourceHost.toLowerCase(),
    input.outcome, Math.max(0, Math.round(input.elapsedMs)), input.fallback, input.brightDataUsed ? 1 : 0,
  ).run();
}

export async function reserveBrightDataBudget(env: LotSocialEnvironment, associateEmail: string) {
  const associate = await incrementDailyLimit(env, "brightdata_associate", associateEmail);
  if (!associate.allowed) return { allowed: false, reason: "associate_cap" as const, associate, global: null };
  const global = await incrementDailyLimit(env, "brightdata_global", "global");
  if (!global.allowed) return { allowed: false, reason: "global_cap" as const, associate, global };
  return { allowed: true, reason: "within_budget" as const, associate, global };
}

export async function importHealth(env: LotSocialEnvironment) {
  await ensureLotSocialSchema(env);
  const rows = await database(env, "import telemetry").prepare(`SELECT
      source_host AS sourceHost,
      COUNT(*) AS attempts,
      SUM(CASE WHEN outcome IN ('direct_success','brightdata_success','listing_guess_success','skipped_budget','reused') THEN 1 ELSE 0 END) AS successes,
      SUM(CASE WHEN bright_data_used = 1 THEN 1 ELSE 0 END) AS brightDataUses,
      SUM(CASE WHEN outcome = 'skipped_budget' THEN 1 ELSE 0 END) AS budgetSkips
    FROM import_outcomes
    WHERE created_at >= datetime('now', '-7 days')
    GROUP BY source_host
    ORDER BY attempts DESC, source_host ASC`).all<{ sourceHost: string; attempts: number; successes: number; brightDataUses: number; budgetSkips: number }>();
  return rows.results.map((row) => ({
    ...row,
    attempts: Number(row.attempts),
    successes: Number(row.successes),
    brightDataUses: Number(row.brightDataUses),
    budgetSkips: Number(row.budgetSkips),
    successRate: Number(row.attempts) ? Number(row.successes) / Number(row.attempts) : 0,
  }));
}

export async function handleImportHealth(request: Request, env: LotSocialEnvironment) {
  const expected = env.ENFORCEMENT_API_KEY?.trim();
  const supplied = request.headers.get("x-enforcement-api-key")?.trim()
    || request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  if (!expected || !supplied || supplied !== expected) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }
  return Response.json({ windowDays: 7, hosts: await importHealth(env) });
}
