import { database, ensureLotSocialSchema } from "./schema-bootstrap.ts";
import type { LotSocialEnvironment } from "./schema-bootstrap.ts";

export type UsageEventType =
  | "account_created"
  | "signed_in"
  | "vehicle_imported"
  | "post_draft_created"
  | "video_render_started"
  | "video_render_completed"
  | "video_downloaded";

export async function recordUsageEvent(input: {
  accountId?: string;
  associateEmail: string;
  eventType: UsageEventType;
  entityType?: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
}, env: LotSocialEnvironment) {
  if (!env.DB || !input.associateEmail.trim()) return;
  try {
    await ensureLotSocialSchema(env);
    await database(env, "LotSocial usage").prepare(`INSERT INTO usage_events
      (id, account_id, associate_email, event_type, entity_type, entity_id, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        crypto.randomUUID(),
        input.accountId ?? "",
        input.associateEmail.trim().toLowerCase(),
        input.eventType,
        input.entityType ?? "",
        input.entityId ?? "",
        JSON.stringify(input.metadata ?? {}).slice(0, 4000),
      ).run();
  } catch (error) {
    console.error("usage_event_write_failed", error);
  }
}

type UsageRow = {
  associate_email: string;
  display_name: string;
  event_type: UsageEventType;
  created_at: string;
};

export async function buildDailyUsageDigest(env: LotSocialEnvironment, now = new Date()) {
  await ensureLotSocialSchema(env);
  const timeZone = "America/Los_Angeles";
  const targetDate = calendarDate(new Date(now.getTime() - 12 * 60 * 60 * 1000), timeZone);
  const since = new Date(now.getTime() - 60 * 60 * 1000 * 48).toISOString();
  const rows = (await database(env, "LotSocial usage").prepare(`SELECT
      e.associate_email, COALESCE(a.display_name, e.associate_email) AS display_name,
      e.event_type, e.created_at
    FROM usage_events e
    LEFT JOIN associate_accounts a ON LOWER(a.email) = LOWER(e.associate_email)
    WHERE e.created_at >= ? ORDER BY e.created_at ASC`)
    .bind(since).all<UsageRow>()).results.filter((row) => calendarDate(parseSqliteDate(row.created_at), timeZone) === targetDate);

  const eventLabels: Record<UsageEventType, string> = {
    account_created: "signup",
    signed_in: "sign-in",
    vehicle_imported: "vehicle",
    post_draft_created: "draft",
    video_render_started: "render started",
    video_render_completed: "render completed",
    video_downloaded: "download",
  };
  const byUser = new Map<string, { name: string; counts: Map<UsageEventType, number> }>();
  for (const row of rows) {
    const current = byUser.get(row.associate_email) ?? { name: row.display_name, counts: new Map<UsageEventType, number>() };
    current.counts.set(row.event_type, (current.counts.get(row.event_type) ?? 0) + 1);
    byUser.set(row.associate_email, current);
  }
  const title = `LotSocial activity — ${targetDate}`;
  if (!rows.length) return { title, message: "No LotSocial activity yesterday.", targetDate, activeUsers: 0 };
  const lines = [...byUser.entries()].map(([email, user]) => {
    const activity = [...user.counts.entries()].map(([type, count]) => `${count} ${eventLabels[type]}`).join(", ");
    return `${user.name} (${email}): ${activity}`;
  });
  return {
    title,
    message: `${byUser.size} active user${byUser.size === 1 ? "" : "s"} yesterday.\n${lines.join("\n")}`,
    targetDate,
    activeUsers: byUser.size,
  };
}

export async function sendDailyUsageDigest(env: LotSocialEnvironment, now = new Date()) {
  const topic = env.NTFY_TOPIC?.trim();
  if (!topic) throw new Error("NTFY_TOPIC is not configured.");
  const baseUrl = (env.NTFY_BASE_URL?.trim() || "https://ntfy.sh").replace(/\/+$/, "");
  const digest = await buildDailyUsageDigest(env, now);
  const response = await fetch(`${baseUrl}/${encodeURIComponent(topic)}`, {
    method: "POST",
    headers: { Title: digest.title, Priority: "default", Tags: "bar_chart" },
    body: digest.message,
  });
  if (!response.ok) throw new Error(`ntfy rejected the LotSocial digest (${response.status}).`);
  return digest;
}

function calendarDate(date: Date, timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(date)
    .filter((part) => part.type !== "literal")
    .map((part) => part.value)
    .join("-");
}

function parseSqliteDate(value: string) {
  const normalized = value.includes("T") ? value : value.replace(" ", "T");
  return new Date(/[zZ]|[+-]\d\d:\d\d$/.test(normalized) ? normalized : `${normalized}Z`);
}
