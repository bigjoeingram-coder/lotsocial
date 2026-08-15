import { getChatGPTUser } from "../../chatgpt-auth";
import { extractVehicleFromVdp, getImportedVehicleBySourceUrl, listImportedVehicles, saveImportedVehicle, serializeVehicle } from "../../lib/vdp";

export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Associate sign-in is required." }, { status: 401 });
  const vehicles = await listImportedVehicles(user.email);
  return Response.json({ vehicles: vehicles.map(serializeVehicle) });
}

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Associate sign-in is required." }, { status: 401 });
  const payload = (await request.json()) as Record<string, unknown>;
  if (payload.authorizedToMarket !== true) return Response.json({ error: "Confirm that you are authorized to market this dealership's vehicle content." }, { status: 400 });
  const sourceUrl = typeof payload.sourceUrl === "string" ? payload.sourceUrl.trim() : "";
  if (!sourceUrl) return Response.json({ error: "Paste a vehicle detail page URL." }, { status: 400 });
  try {
    const existing = await getImportedVehicleBySourceUrl(user.email, sourceUrl);
    if (existing) return Response.json({ vehicle: serializeVehicle(existing), reused: true }, { status: 200 });
    const extracted = await extractVehicleFromVdp(sourceUrl);
    const record = await saveImportedVehicle(user.email, extracted);
    if (!record) throw new Error("The imported vehicle could not be saved.");
    return Response.json({ vehicle: serializeVehicle(record) }, { status: 201 });
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
