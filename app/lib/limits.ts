import { database, ensureLotSocialSchema } from "./schema-bootstrap.ts";
import type { LotSocialEnvironment } from "./schema-bootstrap.ts";

export type DailyLimitName = "vdp_imports" | "authorization_requests" | "manager_email" | "brightdata_associate" | "brightdata_global";

export type DailyLimitResult = {
  allowed: boolean;
  count: number;
  cap: number;
  retryAfterDay: string;
};

const CONFIG_KEYS: Record<DailyLimitName, keyof LotSocialEnvironment> = {
  vdp_imports: "LOTSOCIAL_DAILY_VDP_IMPORT_CAP",
  authorization_requests: "LOTSOCIAL_DAILY_AUTHORIZATION_REQUEST_CAP",
  manager_email: "LOTSOCIAL_DAILY_MANAGER_EMAIL_CAP",
  brightdata_associate: "LOTSOCIAL_DAILY_BRIGHTDATA_ASSOCIATE_CAP",
  brightdata_global: "LOTSOCIAL_DAILY_BRIGHTDATA_GLOBAL_CAP",
};

export async function incrementDailyLimit(
  env: LotSocialEnvironment,
  name: DailyLimitName,
  subject: string,
  now = new Date(),
): Promise<DailyLimitResult> {
  const cap = configuredCap(env, name);
  const normalizedSubject = subject.trim().toLowerCase();
  if (!normalizedSubject) throw new Error("A rate-limit subject is required.");

  await ensureLotSocialSchema(env);
  const day = now.toISOString().slice(0, 10);
  const counterKey = `${name}:${normalizedSubject}`;
  const row = await database(env, "rate-limit")
    .prepare(`INSERT INTO rate_limit_counters (
      counter_key, counter_scope, counter_subject, counter_day, count
    ) VALUES (?, ?, ?, ?, 1)
    ON CONFLICT(counter_key, counter_day) DO UPDATE SET
      count = count + 1,
      updated_at = CURRENT_TIMESTAMP
    RETURNING count`)
    .bind(counterKey, name, normalizedSubject, day)
    .first<{ count: number }>();
  const count = Number(row?.count ?? 0);
  return {
    allowed: count <= cap,
    count,
    cap,
    retryAfterDay: nextUtcDay(day),
  };
}

export function rateLimitResponse(limit: DailyLimitResult, message: string) {
  return Response.json({
    error: `${message} Try again after ${limit.retryAfterDay} UTC or ask the LotSocial owner to raise the cap.`,
    limit: { count: limit.count, cap: limit.cap },
  }, { status: 429 });
}

function configuredCap(env: LotSocialEnvironment, name: DailyLimitName) {
  const key = CONFIG_KEYS[name];
  const value = env[key];
  const cap = Number(typeof value === "string" ? value.trim() : "");
  if (!Number.isInteger(cap) || cap < 1) {
    throw new Error(`LotSocial daily limit ${key} is not configured.`);
  }
  return cap;
}

function nextUtcDay(day: string) {
  const next = new Date(`${day}T00:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
}
