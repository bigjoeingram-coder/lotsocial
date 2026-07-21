import { getChatGPTUser } from "../../chatgpt-auth";
import { saveCreativeProject, serializeCreativeProject } from "../../lib/creative";
import { getImportedVehicle } from "../../lib/vdp";

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Associate sign-in is required." }, { status: 401 });
  const payload = (await request.json()) as Record<string, unknown>;
  const vehicleId = clean(payload.vehicleId);
  const vehicle = await getImportedVehicle(vehicleId, user.email);
  if (!vehicle) return Response.json({ error: "That vehicle is not in your inventory." }, { status: 404 });
  const availableImages = JSON.parse(vehicle.image_urls || "[]") as string[];
  const selectedImages = Array.isArray(payload.selectedImages)
    ? payload.selectedImages.filter((image): image is string => typeof image === "string" && availableImages.includes(image)).slice(0, 10)
    : [];
  const style = ["energetic", "walkaround", "premium"].includes(clean(payload.style)) ? clean(payload.style) : "walkaround";
  const durationSeconds = [15, 30, 45].includes(Number(payload.durationSeconds)) ? Number(payload.durationSeconds) : 30;
  const endCardName = clean(payload.endCardName) || user.displayName;
  const endCardCta = clean(payload.endCardCta) || "Message me for details";
  if (selectedImages.length < 2) return Response.json({ error: "Select at least two VDP photos for the storyboard." }, { status: 400 });
  const project = await saveCreativeProject({
    vehicle,
    associateEmail: user.email,
    selectedImages,
    style,
    durationSeconds,
    endCardName,
    endCardPhone: clean(payload.endCardPhone),
    endCardEmail: clean(payload.endCardEmail) || user.email,
    endCardCta,
  });
  if (!project) return Response.json({ error: "The creative draft could not be saved." }, { status: 500 });
  return Response.json({ project: serializeCreativeProject(project) }, { status: 201 });
}
