import { getChatGPTUser } from "../../../../chatgpt-auth";
import { createRenderJob, getCreativeProject, serializeRenderJob } from "../../../../lib/creative";
import { buildVerticalRenderPlan, submitRender } from "../../../../lib/rendering";
import { getImportedVehicle } from "../../../../lib/vdp";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Associate sign-in is required." }, { status: 401 });
  const { id } = await context.params;
  const project = await getCreativeProject(id, user.email);
  if (!project) return Response.json({ error: "That creative project was not found." }, { status: 404 });
  const vehicle = await getImportedVehicle(project.vehicle_id, user.email);
  if (!vehicle) return Response.json({ error: "The source vehicle is no longer available." }, { status: 404 });

  const plan = buildVerticalRenderPlan(project, vehicle);
  const submission = await submitRender(plan);
  const job = await createRenderJob({
    projectId: project.id,
    associateEmail: user.email,
    renderPlan: plan,
    providerRenderId: submission.providerRenderId,
    status: submission.status,
    errorMessage: submission.errorMessage,
  });
  if (!job) return Response.json({ error: "The render job could not be saved." }, { status: 500 });
  return Response.json({ job: serializeRenderJob(job) }, { status: submission.status === "provider_error" ? 502 : 201 });
}
