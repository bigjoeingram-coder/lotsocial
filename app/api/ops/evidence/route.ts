import { env } from "cloudflare:workers";
import { AssociateAuthError, requireAssociate } from "../../../chatgpt-auth.ts";
import { createEvidenceArtifactToken, listEvidenceForVehicle } from "../../../lib/evidence.ts";
import { secureEqual } from "../../../lib/telemetry.ts";

export async function GET(request: Request) {
  const internalAdmin = validInternalKey(request);
  let user = null;
  if (!internalAdmin) {
    try {
      user = await requireAssociate(request, env);
    } catch (error) {
      if (error instanceof AssociateAuthError) return Response.json({ error: "Unauthorized." }, { status: 401 });
      throw error;
    }
    if (user.role !== "manager" && user.role !== "admin") return Response.json({ error: "Manager or admin access is required." }, { status: 403 });
  }

  const vehicleId = new URL(request.url).searchParams.get("vehicleId")?.trim() ?? "";
  if (!vehicleId) return Response.json({ error: "vehicleId is required." }, { status: 400 });
  const rows = await listEvidenceForVehicle(vehicleId, env);
  const visible = internalAdmin || user?.role === "admin"
    ? rows
    : rows.filter((row) => row.dealership_tenant.toLowerCase() === user?.dealershipDomain?.toLowerCase());
  const expiresAt = Math.floor(Date.now() / 1000) + 900;
  const evidence = await Promise.all(visible.map(async (row) => ({
    ...row,
    sourceArtifactUrl: await signedUrl(request, row.id, "source", expiresAt),
    screenshotArtifactUrl: row.screenshot_storage_key ? await signedUrl(request, row.id, "screenshot", expiresAt) : null,
  })));
  return Response.json({ vehicleId, evidence, linkExpiresAt: new Date(expiresAt * 1000).toISOString() });
}

function validInternalKey(request: Request) {
  if (!env.ENFORCEMENT_API_KEY) return false;
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  return secureEqual(env.ENFORCEMENT_API_KEY, supplied);
}

async function signedUrl(request: Request, id: string, kind: "source" | "screenshot", expiresAt: number) {
  const token = await createEvidenceArtifactToken(id, kind, expiresAt, env);
  const url = new URL(`/api/ops/evidence/artifacts/${id}/${kind}`, request.url);
  url.searchParams.set("expires", String(expiresAt));
  url.searchParams.set("token", token);
  return url.toString();
}
