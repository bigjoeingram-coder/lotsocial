import { database } from "./schema-bootstrap.ts";
import type { LotSocialEnvironment } from "./schema-bootstrap.ts";
import { incrementDailyLimit, rateLimitResponse } from "./limits.ts";
import {
  extractVehicleFromVdp,
  getImportedVehicleBySourceUrl,
  listImportedVehicles,
  saveImportedVehicle,
  serializeVehicle,
} from "./vdp.ts";
import type { ExtractedVehicle, ImportedVehicleRecord } from "./vdp.ts";

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
  try {
    const limit = await incrementDailyLimit(env, "vdp_imports", user.email);
    if (!limit.allowed) {
      return rateLimitResponse(limit, "Daily VDP import limit reached for this associate.");
    }
    const findExisting = dependencies.getImportedVehicleBySourceUrl ?? getImportedVehicleBySourceUrl;
    const existing = await findExisting(user.email, sourceUrl, env);
    const serialize = dependencies.serializeVehicle ?? serializeVehicle;
    if (existing) return Response.json({ vehicle: serialize(existing), reused: true }, { status: 200 });
    const extract = dependencies.extractVehicleFromVdp ?? extractVehicleFromVdp;
    const save = dependencies.saveImportedVehicle ?? saveImportedVehicle;
    const extracted = await extract(sourceUrl, env);
    const record = await save(user.email, extracted, env);
    if (!record) throw new Error("The imported vehicle could not be saved.");
    return Response.json({ vehicle: serialize(record) }, { status: 201 });
  } catch (error) {
    try {
      const parsed = new URL(sourceUrl);
      console.warn("vdp_import_failed", { host: parsed.hostname, path: parsed.pathname, message: error instanceof Error ? error.message : "Unknown import failure" });
    } catch {
      console.warn("vdp_import_failed", { host: "invalid-url", message: error instanceof Error ? error.message : "Unknown import failure" });
    }
    return Response.json({ error: error instanceof Error ? error.message : "Unable to import that VDP." }, { status: 422 });
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
  const vehicle = await db.prepare(
    "SELECT id FROM imported_vehicles WHERE LOWER(associate_email) = LOWER(?) AND source_url = ? LIMIT 1"
  ).bind(user.email, sourceUrl).first<{ id: string }>();

  if (!vehicle) return Response.json({ error: "That vehicle is not in your inventory." }, { status: 404 });

  const projectRows = await db.prepare(
    "SELECT id FROM creative_projects WHERE vehicle_id = ? AND LOWER(associate_email) = LOWER(?)"
  ).bind(vehicle.id, user.email).all<{ id: string }>();

  for (const project of projectRows.results) {
    await db.prepare(
      "DELETE FROM creative_render_jobs WHERE project_id = ? AND LOWER(associate_email) = LOWER(?)"
    ).bind(project.id, user.email).run();
  }

  await db.prepare(
    "DELETE FROM creative_projects WHERE vehicle_id = ? AND LOWER(associate_email) = LOWER(?)"
  ).bind(vehicle.id, user.email).run();

  const result = await db.prepare(
    "DELETE FROM imported_vehicles WHERE id = ? AND LOWER(associate_email) = LOWER(?)"
  ).bind(vehicle.id, user.email).run();

  if (!result.meta.changes) return Response.json({ error: "Vehicle deletion did not complete." }, { status: 409 });

  return Response.json({ deleted: true, vehicleId: vehicle.id });
}

export type { ExtractedVehicle, ImportedVehicleRecord };
