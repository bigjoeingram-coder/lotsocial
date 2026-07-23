import { getChatGPTUser } from "../../../../chatgpt-auth";
import { createRenderJob, getCreativeProject, getLatestRenderJob, serializeRenderJob, updateRenderJob } from "../../../../lib/creative";
import { buildVerticalRenderPlan, checkRender, rendererIsConfigured, submitRender } from "../../../../lib/rendering";
import { getImportedVehicle } from "../../../../lib/vdp";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Associate sign-in is required." }, { status: 401 });
  const { id } = await context.params;
  const project = await getCreativeProject(id, user.email);
  if (!project) return Response.json({ error: "That creative project was not found." }, { status: 404 });
  const existing = await getLatestRenderJob(project.id, user.email);
  const reusableStatuses = ["queued", "fetching", "rendering", "saving", "completed"];
  if (existing && (reusableStatuses.includes(existing.status) || (existing.status === "awaiting_provider_setup" && !rendererIsConfigured()))) {
    return Response.json({ job: serializeRenderJob(existing), reused: true });
  }
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

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Associate sign-in is required." }, { status: 401 });
  const { id } = await context.params;
  const project = await getCreativeProject(id, user.email);
  if (!project) return Response.json({ error: "That creative project was not found." }, { status: 404 });
  const job = await getLatestRenderJob(project.id, user.email);
  if (!job) return Response.json({ error: "No render job exists for this creative project." }, { status: 404 });

  if (job.provider_render_id && ["queued", "fetching", "rendering", "saving"].includes(job.status)) {
    try {
      const providerState = await checkRender(job.provider_render_id);
      if (providerState) {
        const refreshed = await updateRenderJob({ id: job.id, associateEmail: user.email, ...providerState });
        if (refreshed) return Response.json({ job: serializeRenderJob(refreshed) });
      }
    } catch (caught) {
      return Response.json({ job: serializeRenderJob(job), warning: caught instanceof Error ? caught.message : "The renderer status is temporarily unavailable." });
    }
  }
  return Response.json({ job: serializeRenderJob(job) });
}
