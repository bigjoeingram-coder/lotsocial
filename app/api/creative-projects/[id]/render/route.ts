import { getChatGPTUser } from "../../../../chatgpt-auth";
import { createRenderJob, getCreativeProject, getLatestRenderJob, serializeRenderJob, updateRenderJob } from "../../../../lib/creative";
import { buildVerticalRenderPlan, checkRender, rendererIsConfigured, submitRender } from "../../../../lib/rendering";
import { archiveRenderedVideo } from "../../../../lib/media";
import { getImportedVehicle } from "../../../../lib/vdp";

const CURRENT_COPY_POLICY_STARTED_AT = Date.parse("2026-08-20T00:03:20Z");
const UNSAFE_STORED_COPY = /scrapeSource|<br\s*\/?\s*>|(?:pre-owned|used)\s+cars\s+for\s+sale|view\s+\d+\s+matches/i;

function requiresRegeneration(project: { created_at: string; voiceover_script: string; social_caption: string }) {
  const createdAt = Date.parse(project.created_at.replace(" ", "T") + (project.created_at.includes("Z") ? "" : "Z"));
  if (!Number.isFinite(createdAt) || createdAt < CURRENT_COPY_POLICY_STARTED_AT) return true;
  return UNSAFE_STORED_COPY.test(`${project.voiceover_script}\n${project.social_caption}`);
}

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Associate sign-in is required." }, { status: 401 });
  const { id } = await context.params;
  const project = await getCreativeProject(id, user.email);
  if (!project) return Response.json({ error: "That creative project was not found." }, { status: 404 });
  if (requiresRegeneration(project)) {
    return Response.json({ error: "This saved draft predates the current LotSocial safety rules. Regenerate the creative draft before rendering or publishing." }, { status: 409 });
  }
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
  if (requiresRegeneration(project)) {
    return Response.json({ error: "This saved draft predates the current LotSocial safety rules. Regenerate it before continuing.", regenerationRequired: true }, { status: 409 });
  }
  const job = await getLatestRenderJob(project.id, user.email);
  if (!job) return Response.json({ error: "No render job exists for this creative project." }, { status: 404 });

  if (job.provider_render_id && ["queued", "fetching", "rendering", "saving"].includes(job.status)) {
    try {
      const providerState = await checkRender(job.provider_render_id);
      if (providerState) {
        let storedState: { storageKey?: string; outputUrl?: string } = {};
        let storageWarning = "";
        if (providerState.status === "completed" && providerState.outputUrl) {
          try {
            storedState = await archiveRenderedVideo(job.id, user.email, providerState.outputUrl);
          } catch (caught) {
            storageWarning = caught instanceof Error ? caught.message : "Permanent video storage is temporarily unavailable.";
          }
        }
        const refreshed = await updateRenderJob({
          id: job.id,
          associateEmail: user.email,
          ...providerState,
          ...storedState,
          errorMessage: storageWarning,
        });
        if (refreshed) return Response.json({ job: serializeRenderJob(refreshed) });
      }
    } catch (caught) {
      return Response.json({ job: serializeRenderJob(job), warning: caught instanceof Error ? caught.message : "The renderer status is temporarily unavailable." });
    }
  }
  return Response.json({ job: serializeRenderJob(job) });
}
