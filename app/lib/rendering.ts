import { env } from "cloudflare:workers";
import type { CreativeProjectRecord } from "./creative";
import type { ImportedVehicleRecord } from "./vdp";

type RenderEnvironment = { SHOTSTACK_API_KEY?: string; SHOTSTACK_STAGE?: string };
type ShotstackStage = "stage" | "v1";
const INSPECTION_IMAGE_SCALE = 0.92;
const WALLPAPER_BACKGROUND_SCALE = 1.18;
const WALLPAPER_BACKGROUND_OPACITY = 0.38;
const WALLPAPER_TINT_OPACITY = 0.94;

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

function vehicleLine(vehicle: ImportedVehicleRecord) {
  return [vehicle.year, vehicle.make, vehicle.model, vehicle.trim].filter(Boolean).join(" ") || vehicle.title;
}

export function buildVerticalRenderPlan(project: CreativeProjectRecord, vehicle: ImportedVehicleRecord) {
  const images = JSON.parse(project.selected_images || "[]") as string[];
  const total = Math.max(15, project.duration_seconds);
  const endCardLength = Math.min(4, Math.max(3, total * 0.15));
  const imageLength = (total - endCardLength) / images.length;
  const timedImages = images.map((src, index) => ({
    src,
    start: Number((index * imageLength).toFixed(2)),
    length: Number((imageLength + (index < images.length - 1 ? 0.25 : 0)).toFixed(2)),
  }));
  const wallpaperClips = timedImages.map(({ src, start, length }, index) => ({
    asset: { type: "image", src },
    start,
    length,
    fit: "crop",
    scale: WALLPAPER_BACKGROUND_SCALE,
    position: "center",
    opacity: WALLPAPER_BACKGROUND_OPACITY,
    filter: "darken",
    transition: index === 0 ? { out: "fade" } : { in: "fade", out: "fade" },
  }));
  const wallpaperTintClips = timedImages.map(({ start, length }, index) => ({
    asset: { type: "html", html: "<div></div>", css: "div{width:1080px;height:1920px;background:#071116}", width: 1080, height: 1920 },
    start,
    length,
    opacity: WALLPAPER_TINT_OPACITY,
    transition: index === 0 ? { out: "fade" } : { in: "fade", out: "fade" },
  }));
  const clips = timedImages.map(({ src, start, length }, index) => ({
    asset: { type: "image", src },
    start,
    length,
    fit: "contain",
    scale: INSPECTION_IMAGE_SCALE,
    position: "center",
    transition: index === 0 ? { out: "fade" } : { in: "fade", out: "fade" },
  }));
  const endCardContact = [project.end_card_phone, project.end_card_email].filter(Boolean).join("  |  ");
  const endCardHtml = `<div class="end-card"><div class="brand"><span>L</span><b>LotSocial</b></div><p>${escapeHtml(project.end_card_cta)}</p><h1>${escapeHtml(project.end_card_name)}</h1><strong>${escapeHtml(endCardContact)}</strong><small>${escapeHtml(vehicleLine(vehicle))}</small></div>`;
  const endCardCss = "html,body{margin:0}.end-card{box-sizing:border-box;width:1080px;height:1920px;padding:190px 135px 160px;font-family:Arial,Helvetica,sans-serif;color:white;text-align:center;background:linear-gradient(180deg,#071116 0%,#101f24 58%,#05090b 100%);display:flex;flex-direction:column;align-items:center;justify-content:center;overflow:hidden}.brand{display:inline-flex;align-items:center;justify-content:center;gap:20px;margin-bottom:190px}.brand span{width:82px;height:82px;display:grid;place-items:center;border-radius:22px;background:#c8ff43;color:#17242a;font-size:50px;font-weight:900;transform:rotate(-4deg)}.brand b{color:#c8ff43;font-size:31px;letter-spacing:.08em;text-transform:uppercase}.end-card p{max-width:760px;margin:0 0 34px;color:#c8ff43;font-size:42px;line-height:1.08;font-weight:900;letter-spacing:.02em;text-transform:uppercase;overflow-wrap:anywhere}.end-card h1{max-width:800px;margin:0 0 30px;font-size:76px;line-height:.98;letter-spacing:-.04em;overflow-wrap:anywhere}.end-card strong{display:block;max-width:760px;color:#e8f1eb;font-size:30px;line-height:1.28;overflow-wrap:anywhere}.end-card small{display:block;max-width:760px;margin-top:120px;color:#9fb0a7;font-size:24px;line-height:1.3;overflow-wrap:anywhere}";
  const render = {
    timeline: {
      background: "#17242a",
      tracks: [
        { clips: [{ asset: { type: "html", html: endCardHtml, css: endCardCss, width: 1080, height: 1920 }, start: Number((total - endCardLength).toFixed(2)), length: endCardLength }] },
        { clips },
        { clips: wallpaperTintClips },
        { clips: wallpaperClips },
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
      fidelity: "Original dealership VDP photos only, inspection-fit framing with darker same-image wallpaper fill and branded salesperson end card",
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
