import { env } from "cloudflare:workers";
import { sendDailyUsageDigest } from "../../../lib/usage.ts";
import { secureEqual } from "../../../lib/telemetry.ts";

export async function POST(request: Request) {
  const configuredKey = env.ENFORCEMENT_API_KEY?.trim() ?? "";
  const suppliedKey = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ?? "";
  if (!configuredKey || !secureEqual(configuredKey, suppliedKey)) return Response.json({ error: "Unauthorized." }, { status: 401 });
  try {
    return Response.json({ ok: true, digest: await sendDailyUsageDigest(env) });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to send the daily usage digest." }, { status: 502 });
  }
}
