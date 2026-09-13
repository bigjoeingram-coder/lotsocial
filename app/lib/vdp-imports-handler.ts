import { database } from "./schema-bootstrap.ts";
import type { LotSocialEnvironment } from "./schema-bootstrap.ts";
import { incrementDailyLimit, rateLimitResponse } from "./limits.ts";
import {
  createExtractionTrace,
  extractVehicleFromVdp,
  getImportedVehicleBySourceUrl,
  listImportedVehicles,
  saveImportedVehicle,
  serializeVehicle,
  sourceUrlVariants,
} from "./vdp.ts";
import type { ExtractedVehicle, ImportedVehicleRecord } from "./vdp.ts";
import { writeImportOutcome } from "./telemetry.ts";

type RouteUser = {
  displayName: string;
  email: string;
  fullName: string | null;
};

type VdpImportDependencies = {
  associate: RouteUser;
  listImportedVehicles?: typeof listImportedVehicles;
  getImportedVehicleBySourceUrl?: typeof getImportedVehicleBySourceUrl;
  extractVehicleFromVdp?: typeof extractVehicleFromVdp;
  saveImportedVehicle?: typeof saveImportedVehicle;
  serializeVehicle?: typeof serializeVehicle;
  writeImportOutcome?: typeof writeImportOutcome;
};

export async function handleVdpImportsGet(
  _request: Request,
  env: LotSocialEnvironment,
  dependencies: VdpImportDependencies,
) {
  const user = dependencies.associate;
  const vehicles = await (dependencies.listImportedVehicles ?? listImportedVehicles)(user.email, env);
  const serialize = dependencies.serializeVehicle ?? serializeVehicle;
  return Response.json({ vehicles: vehicles.map(serialize) });
}

export async function handleVdpImportsPost(
  request: Request,
  env: LotSocialEnvironment,
  dependencies: VdpImportDependencies,
) {
  const user = dependencies.associate;
  const payload = (await request.json()) as Record<string, unknown>;
  if (payload.authorizedToMarket !== true) {
    return Response.json({ error: "Confirm that you are authorized to market this dealership's vehicle content." }, { status: 400 });
  }
  const sourceUrl = typeof payload.sourceUrl === "string" ? payload.sourceUrl.trim() : "";
  if (!sourceUrl) return Response.json({ error: "Paste a vehicle detail page URL." }, { status: 400 });
  const startedAt = Date.now();
  const trace = createExtractionTrace();
  const sourceHost = hostOf(sourceUrl);
  const recordOutcome = dependencies.writeImportOutcome ?? writeImportOutcome;
  try {
    const limit = await incrementDailyLimit(env, "vdp_imports", user.email);
    if (!limit.allowed) {
      await recordOutcomeSafely(recordOutcome, {
        associateEmail: user.email, sourceHost, outcome: "rate_limited", elapsedMs: Date.now() - startedAt,
        fallback: "none", brightDataUsed: false,
      }, env);
      return rateLimitResponse(limit, "Daily VDP import limit reached for this associate.");
    }
    const findExisting = dependencies.getImportedVehicleBySourceUrl ?? getImportedVehicleBySourceUrl;
    const existing = await findExisting(user.email, sourceUrl, env);
    const serialize = dependencies.serializeVehicle ?? serializeVehicle;
    if (existing) {
      await recordOutcomeSafely(recordOutcome, {
        associateEmail: user.email, sourceHost, outcome: "reused", elapsedMs: Date.now() - startedAt,
        fallback: "none", brightDataUsed: false,
      }, env);
      return Response.json({ vehicle: serialize(existing), reused: true }, { status: 200 });
    }
    const extract = dependencies.extractVehicleFromVdp ?? extractVehicleFromVdp;
    const save = dependencies.saveImportedVehicle ?? saveImportedVehicle;
    const extracted = await extract(sourceUrl, env, { associateEmail: user.email, trace });
    const record = await save(user.email, extracted, env);
    if (!record) throw new Error("The imported vehicle could not be saved.");
    const outcome = trace.budgetSkipped
      ? "skipped_budget_success"
      : trace.fallback === "bright_data" ? "bright_data_success"
        : trace.fallback === "listing_guess" ? "listing_guess_success" : "direct_success";
    await recordOutcomeSafely(recordOutcome, {
      associateEmail: user.email, sourceHost, outcome, elapsedMs: Date.now() - startedAt,
      fallback: trace.fallback, brightDataUsed: trace.brightDataUsed, notice: trace.notice,
    }, env);
    return Response.json({ vehicle: serialize(record), notice: trace.notice || undefined }, { status: 201 });
  } catch (error) {
    const outcome = trace.budgetSkipped ? "skipped_budget_failure" : trace.networkTimedOut ? "network_timeout" : "parse_failure";
    await recordOutcomeSafely(recordOutcome, {
      associateEmail: user.email, sourceHost, outcome, elapsedMs: Date.now() - startedAt,
      fallback: trace.fallback, brightDataUsed: trace.brightDataUsed, notice: trace.notice,
    }, env);
    try {
      const parsed = new URL(sourceUrl);
      console.warn("vdp_import_failed", { host: parsed.hostname, path: parsed.pathname, message: error instanceof Error ? error.message : "Unknown import failure" });
    } catch {
      console.warn("vdp_import_failed", { host: "invalid-url", message: error instanceof Error ? error.message : "Unknown import failure" });
    }
    return Response.json({
      error: error instanceof Error ? error.message : "Unable to import that VDP.",
      notice: trace.notice || undefined,
    }, { status: 422 });
  }
}

function hostOf(value: string) {
  try { return new URL(value).hostname.toLowerCase(); } catch { return "invalid-url"; }
}

async function recordOutcomeSafely(
  writer: typeof writeImportOutcome,
  input: Parameters<typeof writeImportOutcome>[0],
  env: LotSocialEnvironment,
) {
  try {
    await writer(input, env);
  } catch (error) {
    console.error("vdp_import_telemetry_failed", { message: error instanceof Error ? error.message : "Unknown telemetry failure" });
  }
}

type VdpDeleteDependencies = {
  associate: RouteUser;
};

export async function handleVdpImportDelete(
  request: Request,
  env: LotSocialEnvironment,
  dependencies: VdpDeleteDependencies,
) {
  const user = dependencies.associate;

  const payload = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const sourceUrl = typeof payload.sourceUrl === "string" ? payload.sourceUrl.trim() : "";
  if (!sourceUrl) return Response.json({ error: "Vehicle source URL is required." }, { status: 400 });

  const db = database(env, "inventory");
  const variants = sourceUrlVariants(sourceUrl);
  const placeholders = variants.map(() => "?").join(", ");
  const vehicle = await db.prepare(
    `SELECT id FROM imported_vehicles WHERE LOWER(associate_email) = LOWER(?) AND source_url IN (${placeholders}) ORDER BY updated_at DESC LIMIT 1`
  ).bind(user.email, ...variants).first<{ id: string }>();

  if (!vehicle) return Response.json({ error: "That vehicle is not in your inventory." }, { status: 404 });

  const statements = [db.prepare(
    `DELETE FROM creative_render_jobs
     WHERE LOWER(associate_email) = LOWER(?)
       AND project_id IN (
         SELECT id FROM creative_projects
         WHERE vehicle_id = ? AND LOWER(associate_email) = LOWER(?)
       )`
  ).bind(user.email, vehicle.id, user.email), db.prepare(
    "DELETE FROM creative_projects WHERE vehicle_id = ? AND LOWER(associate_email) = LOWER(?)"
  ).bind(vehicle.id, user.email), db.prepare(
    "DELETE FROM imported_vehicles WHERE id = ? AND LOWER(associate_email) = LOWER(?)"
  ).bind(vehicle.id, user.email)];

  const results = await db.batch<{ meta: { changes: number } }>(statements);
  const result = results.at(-1);

  if (!result?.meta.changes) return Response.json({ error: "Vehicle deletion did not complete." }, { status: 409 });

  return Response.json({ deleted: true, vehicleId: vehicle.id });
}

export type { ExtractedVehicle, ImportedVehicleRecord };
