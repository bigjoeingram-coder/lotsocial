import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../../chatgpt-auth";

function database() {
  if (!env.DB) throw new Error("The inventory database is unavailable.");
  return env.DB;
}

export async function DELETE(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Associate sign-in is required." }, { status: 401 });

  const payload = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const sourceUrl = typeof payload.sourceUrl === "string" ? payload.sourceUrl.trim() : "";
  if (!sourceUrl) return Response.json({ error: "Vehicle source URL is required." }, { status: 400 });

  const vehicle = await database().prepare(
    "SELECT id FROM imported_vehicles WHERE LOWER(associate_email) = LOWER(?) AND source_url = ? LIMIT 1"
  ).bind(user.email, sourceUrl).first<{ id: string }>();

  if (!vehicle) return Response.json({ error: "That vehicle is not in your inventory." }, { status: 404 });

  // Keep deletion scoped to the signed-in associate. Dependent creative rows are removed first
  // so an orphaned storyboard or render cannot survive after its source vehicle is deleted.
  const projectRows = await database().prepare(
    "SELECT id FROM creative_projects WHERE vehicle_id = ? AND LOWER(associate_email) = LOWER(?)"
  ).bind(vehicle.id, user.email).all<{ id: string }>();

  for (const project of projectRows.results) {
    await database().prepare(
      "DELETE FROM creative_render_jobs WHERE project_id = ? AND LOWER(associate_email) = LOWER(?)"
    ).bind(project.id, user.email).run();
  }

  await database().prepare(
    "DELETE FROM creative_projects WHERE vehicle_id = ? AND LOWER(associate_email) = LOWER(?)"
  ).bind(vehicle.id, user.email).run();

  const result = await database().prepare(
    "DELETE FROM imported_vehicles WHERE id = ? AND LOWER(associate_email) = LOWER(?)"
  ).bind(vehicle.id, user.email).run();

  if (!result.meta.changes) return Response.json({ error: "Vehicle deletion did not complete." }, { status: 409 });

  return Response.json({ deleted: true, vehicleId: vehicle.id });
}
