import { env } from "cloudflare:workers";
import { importHealth, secureEqual } from "../../../lib/telemetry.ts";

export async function GET(request: Request) {
  const configuredKey = env.ENFORCEMENT_API_KEY;
  if (!configuredKey) return Response.json({ error: "Import health is not configured." }, { status: 503 });
  const suppliedKey = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!secureEqual(configuredKey, suppliedKey)) return Response.json({ error: "Unauthorized." }, { status: 401 });
  const hosts = await importHealth(env);
  return Response.json({ windowDays: 7, hosts, checkedAt: new Date().toISOString() });
}
