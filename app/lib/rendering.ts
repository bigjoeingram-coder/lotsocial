import { env } from "cloudflare:workers";
import type { CreativeProjectRecord } from "./creative";
import type { ImportedVehicleRecord } from "./vdp";

type RenderEnvironment = { SHOTSTACK_API_KEY?: string; SHOTSTACK_STAGE?: string };
type ShotstackStage = "stage" | "v1";
const INSPECTION_IMAGE_SCALE = 0.92;

function renderEnvironment() {
  const runtime = env as unknown as RenderEnvironment;
  const stage: ShotstackStage = runtime.SHOTSTACK_STAGE === "v1" ? "v1" : "stage";
  return {
    apiKey: runtime.SHOTSTACK_API_KEY?.trim() ?? "",
    stage,
  };
}

export function rendererIsConfigured() {
  return Boolean(renderEnvironment().apiKey);
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;",
  })[character] ?? character);
}

export function buildVerticalRenderPlan(project: CreativeProjectRecord, vehicle: ImportedVehicleRecord) {
  const images = JSON.parse(project.selected_images || "[]") as string[];
  const total = Math.max(15, project.duration_seconds);
  const endCardLength = Math.min(4, Math.max(3, total * 0.15));
  const imageLength = (total - endCardLength) / images.length;
  const clips = images.map((src, index) => ({
    asset: { type: "image", src },
    start: Number((index * imageLength).toFixed(2)),
    length: Number((imageLength + (index < images.length - 1 ? 0.25 : 0)).toFixed(2)),
    fit: "contain",
    scale: INSPECTION_IMAGE_SCALE,
    position: "center",
    transition: { in: "fade", out: "fade" },
  }));
  const endCardHtml = `<div><p>${escapeHtml(project.end_card_cta)}</p><h1>${escapeHtml(project.end_card_name)}</h1><strong>${escapeHtml([project.end_card_phone, project.end_card_email].filter(Boolean).join("  ·  "))}</strong></div>`;
  const render = {
    timeline: {
      background: "#17242a",
      tracks: [
        { clips: [{ asset: { type: "html", html: endCardHtml, css: "div{font-family:Arial;color:#17242a;text-align:center;padding:560px 70px 0}p{font-size:38px}h1{font-size:80px;margin:18px 0}strong{font-size:28px}", width: 1080, height: 1920 }, start: Number((total - endCardLength).toFixed(2)), length: endCardLength }] },
        { clips },
      ],
    },
    output: { format: "mp4", resolution: "hd", aspectRatio: "9:16", fps: 30 },
  };
  return {
    render,
    summary: {
      format: "9:16 MP4",
      durationSeconds: total,
      photoCount: images.length,
      endCardSeconds: endCardLength,
      style: project.style,
      fidelity: "Original dealership VDP photos only, inspection-fit framing",
    },
  };
}

export async function submitRender(plan: ReturnType<typeof buildVerticalRenderPlan>) {
  const { apiKey, stage } = renderEnvironment();
  if (!apiKey) return { status: "awaiting_provider_setup", providerRenderId: "", errorMessage: "The production renderer is not connected yet." };

  const stages: ShotstackStage[] = stage === "v1" ? ["v1", "stage"] : ["stage", "v1"];
  let latestMessage = "The renderer rejected this job.";
  let rendererAuthRejected = false;
  for (const candidateStage of stages) {
    const response = await fetch(`https://api.shotstack.io/edit/${candidateStage}/render`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey },
      body: JSON.stringify(plan.render),
    });
    const payload = await response.json() as { response?: { id?: string; message?: string }; message?: string };
    if (response.ok && payload.response?.id) {
      return { status: "queued", providerRenderId: `${candidateStage}:${payload.response.id}`, errorMessage: "" };
    }
    latestMessage = payload.response?.message ?? payload.message ?? latestMessage;
    rendererAuthRejected = response.status === 401 || response.status === 403;
    if (!rendererAuthRejected) break;
  }
  if (rendererAuthRejected) {
    latestMessage = "The video renderer rejected the current provider credentials. Import and captions still work, but production video rendering needs the renderer connection updated.";
  }
  return { status: "provider_error", providerRenderId: "", errorMessage: latestMessage };
}

function parseProviderRenderId(providerRenderId: string) {
  const [maybeStage, ...rest] = providerRenderId.split(":");
  if ((maybeStage === "stage" || maybeStage === "v1") && rest.length) {
    return { stage: maybeStage, id: rest.join(":") };
  }
  return { stage: renderEnvironment().stage, id: providerRenderId };
}

export async function checkRender(providerRenderId: string) {
  const { apiKey } = renderEnvironment();
  if (!apiKey) return null;
  const provider = parseProviderRenderId(providerRenderId);
  const response = await fetch(`https://api.shotstack.io/edit/${provider.stage}/render/${encodeURIComponent(provider.id)}`, {
    headers: { "x-api-key": apiKey },
  });
  const payload = await response.json() as {
    response?: { status?: string; url?: string; error?: string; message?: string };
    message?: string;
  };
  if (!response.ok || !payload.response?.status) throw new Error(payload.response?.message ?? payload.message ?? "Unable to check the render status.");
  const providerStatus = payload.response.status;
  const normalizedStatus = providerStatus === "done" ? "completed" : providerStatus === "failed" ? "failed" : providerStatus;
  return {
    status: normalizedStatus,
    outputUrl: payload.response.url ?? "",
    errorMessage: payload.response.error ?? "",
  };
}
