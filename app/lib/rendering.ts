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
  const endCardPhone = project.end_card_phone ? `<div class="phone">${escapeHtml(project.end_card_phone)}</div>` : "";
  const endCardEmail = project.end_card_email ? `<div class="email">${escapeHtml(project.end_card_email)}</div>` : "";
  const endCardHtml = `<div class="end-card"><div class="content"><div class="brand"><span>L</span><b>LotSocial</b></div><p>${escapeHtml(project.end_card_cta)}</p><h1>${escapeHtml(project.end_card_name)}</h1><div class="contact">${endCardPhone}${endCardEmail}</div><small>${escapeHtml(vehicleLine(vehicle))}</small></div></div>`;
  const endCardCss = "html,body{margin:0}.end-card{box-sizing:border-box;position:relative;width:1080px;height:1920px;font-family:Arial,Helvetica,sans-serif;color:white;text-align:center;background:linear-gradient(180deg,#071116 0%,#101f24 58%,#05090b 100%);overflow:hidden}.content{position:absolute;left:190px;right:190px;top:560px}.brand{display:block;margin:0 auto 135px;color:#c8ff43}.brand span{display:inline-block;width:66px;height:66px;line-height:66px;border-radius:15px;background:#c8ff43;color:#17242a;font-size:43px;font-weight:900;vertical-align:middle;transform:rotate(-4deg)}.brand b{display:inline-block;margin-left:13px;color:#c8ff43;font-size:34px;letter-spacing:.08em;text-transform:uppercase;vertical-align:middle}.end-card p{max-width:700px;margin:0 auto 24px;color:#c8ff43;font-size:30px;line-height:1.1;font-weight:900;letter-spacing:.02em;text-transform:uppercase;overflow-wrap:anywhere}.end-card h1{max-width:700px;margin:0 auto 24px;font-size:56px;line-height:1;letter-spacing:-.03em;overflow-wrap:anywhere}.contact{max-width:700px;margin:0 auto}.phone{display:block;margin:8px auto 0;color:#e8f1eb;font-size:29px;line-height:1.22;font-weight:900;overflow-wrap:anywhere}.email{display:block;margin:10px auto 0;color:#e8f1eb;font-size:24px;line-height:1.22;font-weight:650;overflow-wrap:anywhere}.end-card small{display:block;max-width:700px;margin:75px auto 0;color:#9fb0a7;font-size:18px;line-height:1.28;overflow-wrap:anywhere}";
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
