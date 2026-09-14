import { database } from "./schema-bootstrap.ts";
import type { LotSocialEnvironment } from "./schema-bootstrap.ts";
import { incrementDailyLimit, rateLimitResponse } from "./limits.ts";
import {
  extractVehicleFromVdp,
  getImportedVehicleBySourceUrl,
  listImportedVehicles,
  saveImportedVehicle,
  serializeVehicle,
  sourceUrlVariants,
} from "./vdp.ts";
import type { ExtractedVehicle, ImportedVehicleRecord } from "./vdp.ts";
import { recordImportOutcome } from "./telemetry.ts";
import type { ImportTelemetry } from "./telemetry.ts";
import type { VdpExtractionContext } from "./vdp.ts";

type RouteUser = {
  displayName: string;
  email: string;
  fullName: string | null;
};

type VdpImportDependencies = {
  associate: RouteUser;
  listImportedVehicles?: typeof listImportedVehicles;
  getImportedVehicleBySourceUrl?: typeof getImportedVehicleBySourceUrl;
  extractVehicleFromVdp?: (sourceUrl: string, env: LotSocialEnvironment, context?: VdpExtractionContext) => Promise<ExtractedVehicle>;
  saveImportedVehicle?: typeof saveImportedVehicle;
  serializeVehicle?: typeof serializeVehicle;
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
  const startedAt = Date.now();
  const payload = (await request.json()) as Record<string, unknown>;
  if (payload.authorizedToMarket !== true) {
    return Response.json({ error: "Confirm that you are authorized to market this dealership's vehicle content." }, { status: 400 });
  }
  const sourceUrl = typeof payload.sourceUrl === "string" ? payload.sourceUrl.trim() : "";
  if (!sourceUrl) return Response.json({ error: "Paste a vehicle detail page URL." }, { status: 400 });

  let telemetry: ImportTelemetry | null = null;
  let sourceHost = "invalid-url";
  try { sourceHost = new URL(sourceUrl).hostname.toLowerCase(); } catch { /* extractor returns the user-safe URL error */ }
  const report = (value: ImportTelemetry) => { telemetry ??= value; };

  try {
    const limit = await incrementDailyLimit(env, "vdp_imports", user.email);
    if (!limit.allowed) {
      telemetry = { outcome: "rate_limited", fallback: "none", brightDataUsed: false };
      return rateLimitResponse(limit, "Daily VDP import limit reached for this associate.");
    }
    const findExisting = dependencies.getImportedVehicleBySourceUrl ?? getImportedVehicleBySourceUrl;
    const existing = await findExisting(user.email, sourceUrl, env);
    const serialize = dependencies.serializeVehicle ?? serializeVehicle;
    if (existing) {
      telemetry = { outcome: "reused", fallback: "existing_record", brightDataUsed: false };
      return Response.json({ vehicle: serialize(existing), reused: true }, { status: 200 });
    }
    const extract = dependencies.extractVehicleFromVdp ?? extractVehicleFromVdp;
    const save = dependencies.saveImportedVehicle ?? saveImportedVehicle;
    const extracted = await extract(sourceUrl, env, { associateEmail: user.email, report });
    const record = await save(user.email, extracted, env);
    if (!record) throw new Error("The imported vehicle could not be saved.");
    const body: Record<string, unknown> = { vehicle: serialize(record) };
    if (telemetry?.notice) body.notice = telemetry.notice;
    if (telemetry?.budgetSkipped) body.budgetSkipped = true;
    return Response.json(body, { status: 201 });
  } catch (error) {
    try {
      const parsed = new URL(sourceUrl);
      console.warn("vdp_import_failed", { host: parsed.hostname, path: parsed.pathname, message: error instanceof Error ? error.message : "Unknown import failure" });
    } catch {
      console.warn("vdp_import_failed", { host: "invalid-url", message: error instanceof Error ? error.message : "Unknown import failure" });
    }
    telemetry ??= { outcome: error instanceof Error && error.name === "AbortError" ? "network_timeout" : "parse_failure", fallback: "none", brightDataUsed: false };
    const body: Record<string, unknown> = { error: error instanceof Error ? error.message : "Unable to import that VDP." };
    if (telemetry.notice) body.notice = telemetry.notice;
    if (telemetry.budgetSkipped) body.budgetSkipped = true;
    return Response.json(body, { status: 422 });
  } finally {
    if (telemetry) {
      try {
        await recordImportOutcome(env, {
          associateEmail: user.email, sourceHost, outcome: telemetry.outcome,
          elapsedMs: Date.now() - startedAt, fallback: telemetry.fallback, brightDataUsed: telemetry.brightDataUsed,
        });
      } catch (telemetryError) {
        console.warn("vdp_import_telemetry_failed", { sourceHost, message: telemetryError instanceof Error ? telemetryError.message : "unknown" });
      }
    }
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
