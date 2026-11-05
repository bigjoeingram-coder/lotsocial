import { database, ensureLotSocialSchema } from "./schema-bootstrap.ts";
import type { LotSocialEnvironment } from "./schema-bootstrap.ts";
import { secureEqual } from "./telemetry.ts";
import type { AdapterRegistry } from "./posting/adapter.ts";
import { defaultDeps } from "./posting/engine.ts";
import type { PostingDeps } from "./posting/engine.ts";
import { runPostingTick } from "./posting/tick.ts";

export type PostingEnvironment = LotSocialEnvironment & { LOTSOCIAL_POSTING_ENABLED?: string };

// Live adapters are registered here when they exist. It is empty on purpose:
// with no adapter registered, the engine cannot send anything to any platform.
export const PRODUCTION_ADAPTERS: AdapterRegistry = {};

// One engine pass, on demand. Off unless LOTSOCIAL_POSTING_ENABLED is "true",
// and callable only with the internal enforcement key. Nothing schedules it yet.
export async function handlePostingTick(request: Request, env: PostingEnvironment, adapters: AdapterRegistry = PRODUCTION_ADAPTERS, overrides: Partial<PostingDeps> = {}) {
  if (env.LOTSOCIAL_POSTING_ENABLED !== "true") return Response.json({ error: "The posting engine is switched off." }, { status: 503 });
  const configuredKey = env.ENFORCEMENT_API_KEY;
  if (!configuredKey) return Response.json({ error: "The posting engine is not configured." }, { status: 503 });
  const suppliedKey = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!secureEqual(configuredKey, suppliedKey)) return Response.json({ error: "Unauthorized." }, { status: 401 });

  await ensureLotSocialSchema(env);
  const deps = defaultDeps(database(env, "posting"), adapters, overrides);
  const summary = await runPostingTick(deps);
  return Response.json({
    checkedAt: deps.now().toISOString(),
    adapters: Object.keys(adapters),
    reconcile: summary.reconcile,
    dispatched: summary.dispatched,
  });
}
