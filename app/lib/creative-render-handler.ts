import { createRenderJob, getCreativeProject, getLatestRenderJob, serializeRenderJob, updateRenderJob } from "./creative.ts";
import type { CreativeProjectRecord, CreativeRenderJobRecord } from "./creative.ts";
import { archiveRenderedVideo } from "./media.ts";
import type { LotSocialEnvironment } from "./schema-bootstrap.ts";
import { getImportedVehicle } from "./vdp.ts";
import {
  buildVerticalRenderPlan,
  buildSignedRenderSourceUrls,
  checkRender,
  rendererIsConfigured,
  submitRender,
  validateSignedRenderSourceUrls,
} from "./rendering.ts";

type RouteUser = {
  displayName: string;
  email: string;
  fullName: string | null;
};

type RenderContext = { params: Promise<{ id: string }> };

type CreativeRenderDependencies = {
  associate: RouteUser;
  getCreativeProject?: typeof getCreativeProject;
  getLatestRenderJob?: typeof getLatestRenderJob;
  rendererIsConfigured?: typeof rendererIsConfigured;
  getImportedVehicle?: typeof getImportedVehicle;
  buildVerticalRenderPlan?: typeof buildVerticalRenderPlan;
  submitRender?: typeof submitRender;
  createRenderJob?: typeof createRenderJob;
  checkRender?: typeof checkRender;
  archiveRenderedVideo?: typeof archiveRenderedVideo;
  updateRenderJob?: typeof updateRenderJob;
  serializeRenderJob?: typeof serializeRenderJob;
};

const CURRENT_COPY_POLICY_STARTED_AT = Date.parse("2026-08-20T00:03:20Z");
const UNSAFE_STORED_COPY = /scrapeSource|<br\s*\/?\s*>|(?:pre-owned|used)\s+cars\s+for\s+sale|view\s+\d+\s+matches/i;

export function requiresRegeneration(project: { created_at: string; voiceover_script: string; social_caption: string }) {
  const createdAt = Date.parse(project.created_at.replace(" ", "T") + (project.created_at.includes("Z") ? "" : "Z"));
  if (!Number.isFinite(createdAt) || createdAt < CURRENT_COPY_POLICY_STARTED_AT) return true;
  return UNSAFE_STORED_COPY.test(`${project.voiceover_script}\n${project.social_caption}`);
}

export async function handleCreativeRenderPost(
  _request: Request,
  env: LotSocialEnvironment,
  context: RenderContext,
  dependencies: CreativeRenderDependencies,
) {
  const user = dependencies.associate;
  const { id } = await context.params;
  const project = await (dependencies.getCreativeProject ?? getCreativeProject)(id, user.email, env);
  if (!project) return Response.json({ error: "That creative project was not found." }, { status: 404 });
  if (requiresRegeneration(project)) {
    return Response.json({ error: "This saved draft predates the current LotSocial safety rules. Regenerate the creative draft before rendering or publishing." }, { status: 409 });
  }
  const existing = await (dependencies.getLatestRenderJob ?? getLatestRenderJob)(project.id, user.email, env);
  const reusableStatuses = ["queued", "fetching", "preprocessing", "rendering", "saving", "completed"];
  const isConfigured = dependencies.rendererIsConfigured ?? rendererIsConfigured;
  const serialize = dependencies.serializeRenderJob ?? serializeRenderJob;
  if (existing && (reusableStatuses.includes(existing.status) || (existing.status === "awaiting_provider_setup" && !isConfigured(env)))) {
    return Response.json({ job: serialize(existing), reused: true });
  }
  const vehicle = await (dependencies.getImportedVehicle ?? getImportedVehicle)(project.vehicle_id, user.email, env);
  if (!vehicle) return Response.json({ error: "The source vehicle is no longer available." }, { status: 404 });

  let signedSources: string[];
  try {
    signedSources = await buildSignedRenderSourceUrls(project, env);
    await validateSignedRenderSourceUrls(signedSources);
  } catch (caught) {
    return Response.json({ error: caught instanceof Error ? caught.message : "The selected photos could not be prepared. No render was submitted or charged." }, { status: 422 });
  }
  const sourceHostname = env.LOTSOCIAL_EXPECTED_SITES_HOSTNAME?.trim();
  const sourceOrigin = signedSources.length ? signedSources : sourceHostname ? `https://${sourceHostname}` : "";
  const plan = (dependencies.buildVerticalRenderPlan ?? buildVerticalRenderPlan)(project, vehicle, sourceOrigin, project.end_card_photo_url);
  const submission = await (dependencies.submitRender ?? submitRender)(plan, env);
  const job = await (dependencies.createRenderJob ?? createRenderJob)({
    projectId: project.id,
    associateEmail: user.email,
    renderPlan: plan,
    providerRenderId: submission.providerRenderId,
    status: submission.status,
    errorMessage: submission.errorMessage,
    env,
  });
  if (!job) return Response.json({ error: "The render job could not be saved." }, { status: 500 });
  return Response.json({ job: serialize(job) }, { status: submission.status === "provider_error" ? 502 : 201 });
}

export async function handleCreativeRenderGet(
  _request: Request,
  env: LotSocialEnvironment,
  context: RenderContext,
  dependencies: CreativeRenderDependencies,
) {
  const user = dependencies.associate;
  const serialize = dependencies.serializeRenderJob ?? serializeRenderJob;
  const { id } = await context.params;
  const project = await (dependencies.getCreativeProject ?? getCreativeProject)(id, user.email, env);
  if (!project) return Response.json({ error: "That creative project was not found." }, { status: 404 });
  if (requiresRegeneration(project)) {
    return Response.json({ error: "This saved draft predates the current LotSocial safety rules. Regenerate it before continuing.", regenerationRequired: true }, { status: 409 });
  }
  const job = await (dependencies.getLatestRenderJob ?? getLatestRenderJob)(project.id, user.email, env);
  if (!job) return Response.json({ error: "No render job exists for this creative project." }, { status: 404 });

  const shouldRefreshProvider = job.provider_render_id && (
    ["queued", "fetching", "preprocessing", "rendering", "saving"].includes(job.status)
    || (job.status === "failed" && !job.error_message)
  );
  if (shouldRefreshProvider) {
    try {
      const providerState = await (dependencies.checkRender ?? checkRender)(job.provider_render_id, env);
      if (providerState) {
        let storedState: { storageKey?: string; outputUrl?: string } = {};
        let storageWarning = "";
        if (providerState.status === "completed" && providerState.outputUrl) {
          try {
            storedState = await (dependencies.archiveRenderedVideo ?? archiveRenderedVideo)(job.id, user.email, providerState.outputUrl, env);
          } catch (caught) {
            storageWarning = caught instanceof Error ? caught.message : "Permanent video storage is temporarily unavailable.";
          }
        }
        const refreshed = await (dependencies.updateRenderJob ?? updateRenderJob)({
          id: job.id,
          associateEmail: user.email,
          ...providerState,
          ...storedState,
          errorMessage: storageWarning,
          env,
        });
        if (refreshed) return Response.json({ job: serialize(refreshed) });
      }
    } catch (caught) {
      return Response.json({ job: serialize(job), warning: caught instanceof Error ? caught.message : "The renderer status is temporarily unavailable." });
    }
  }
  return Response.json({ job: serialize(job) });
}

export type { CreativeProjectRecord, CreativeRenderJobRecord };
