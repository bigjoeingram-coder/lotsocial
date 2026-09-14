import type { LotSocialEnvironment } from "./schema-bootstrap.ts";
import type { CreativeProjectRecord } from "./creative.ts";
import { normalizeVehicleYear } from "./vdp.ts";
import type { ImportedVehicleRecord } from "./vdp.ts";

type RenderEnvironment = { SHOTSTACK_API_KEY?: string; SHOTSTACK_STAGE?: string };
type ShotstackStage = "stage" | "v1";
const INSPECTION_IMAGE_SCALE = 0.92;
const WALLPAPER_BACKGROUND_SCALE = 1.18;
const WALLPAPER_BACKGROUND_OPACITY = 0.38;
const WALLPAPER_TINT_OPACITY = 0.94;
const INGEST_POLL_ATTEMPTS = 30;

function renderEnvironment(env: LotSocialEnvironment) {
  const runtime = env as RenderEnvironment;
  const stage: ShotstackStage = runtime.SHOTSTACK_STAGE === "v1" ? "v1" : "stage";
  return {
    apiKey: runtime.SHOTSTACK_API_KEY?.trim() ?? "",
    stage,
  };
}

export function rendererIsConfigured(env: LotSocialEnvironment) {
  return Boolean(renderEnvironment(env).apiKey);
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;",
  })[character] ?? character);
}

function vehicleLine(vehicle: ImportedVehicleRecord) {
  return [normalizeVehicleYear(vehicle.year), vehicle.make, vehicle.model, vehicle.trim].filter(Boolean).join(" ") || vehicle.title;
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
  const endCardProfile = project.end_card_photo_url ? `<img class="profile" src="${escapeHtml(project.end_card_photo_url)}" alt="" />` : "";
  const endCardHtml = `<div class="end-card"><div class="content"><div class="brand"><span>L</span><b>LotSocial</b></div>${endCardProfile}<p>${escapeHtml(project.end_card_cta)}</p><h1>${escapeHtml(project.end_card_name)}</h1><div class="contact">${endCardPhone}${endCardEmail}</div><small>${escapeHtml(vehicleLine(vehicle))}</small></div></div>`;
  const endCardCss = "html,body{margin:0}.end-card{box-sizing:border-box;position:relative;width:1080px;height:1920px;font-family:Arial,Helvetica,sans-serif;color:white;text-align:center;background:linear-gradient(180deg,#071116 0%,#101f24 58%,#05090b 100%);overflow:hidden}.content{position:absolute;left:205px;right:205px;top:405px}.brand{display:block;margin:0 auto 78px;color:#c8ff43}.brand span{display:inline-block;width:66px;height:66px;line-height:66px;border-radius:15px;background:#c8ff43;color:#17242a;font-size:43px;font-weight:900;vertical-align:middle;transform:rotate(-4deg)}.brand b{display:inline-block;margin-left:13px;color:#c8ff43;font-size:34px;letter-spacing:.08em;text-transform:uppercase;vertical-align:middle}.profile{display:block;width:250px;height:250px;margin:0 auto 58px;border:8px solid #c8ff43;border-radius:50%;object-fit:cover;background:#17242a;box-shadow:0 24px 70px rgba(0,0,0,.34)}.end-card p{max-width:670px;margin:0 auto 24px;color:#c8ff43;font-size:29px;line-height:1.1;font-weight:900;letter-spacing:.02em;text-transform:uppercase;overflow-wrap:anywhere}.end-card h1{max-width:670px;margin:0 auto 24px;font-size:54px;line-height:1;letter-spacing:-.03em;overflow-wrap:anywhere}.contact{max-width:670px;margin:0 auto}.phone{display:block;margin:10px auto 0;color:#e8f1eb;font-size:31px;line-height:1.22;font-weight:900;overflow-wrap:anywhere}.email{display:block;margin:13px auto 0;color:#e8f1eb;font-size:24px;line-height:1.22;font-weight:650;overflow-wrap:anywhere}.end-card small{display:block;max-width:670px;margin:72px auto 0;color:#9fb0a7;font-size:18px;line-height:1.28;overflow-wrap:anywhere}";
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

function providerMessage(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (value && typeof value === "object" && "message" in value && typeof value.message === "string") return value.message.trim();
  return "";
}

function needsImageRendition(src: string) {
  try {
    return /\.avif$/i.test(new URL(src).pathname);
  } catch {
    return /\.avif(?:$|[?#])/i.test(src);
  }
}

async function imageRendition(src: string, apiKey: string, stage: ShotstackStage) {
  const queued = await fetch(`https://api.shotstack.io/ingest/${stage}/sources`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", "x-api-key": apiKey },
    body: JSON.stringify({
      url: src,
      outputs: { renditions: [{ format: "jpg", resolution: "fhd", fit: "contain", quality: 82 }] },
    }),
  });
  const queuedPayload = await queued.json() as { data?: { id?: string }; message?: string; error?: unknown };
  const sourceId = queuedPayload.data?.id;
  if (!queued.ok || !sourceId) throw new Error(providerMessage(queuedPayload.error) || queuedPayload.message || "The renderer could not prepare this dealership image.");

  for (let attempt = 0; attempt < INGEST_POLL_ATTEMPTS; attempt += 1) {
    const response = await fetch(`https://api.shotstack.io/ingest/${stage}/sources/${encodeURIComponent(sourceId)}`, {
      headers: { Accept: "application/json", "x-api-key": apiKey },
    });
    const payload = await response.json() as {
      data?: { attributes?: { status?: string; error?: unknown; outputs?: { renditions?: Array<{ status?: string; url?: string; error?: unknown }> } } };
      message?: string;
      error?: unknown;
    };
    const attributes = payload.data?.attributes;
    const rendition = attributes?.outputs?.renditions?.[0];
    if (response.ok && rendition?.status === "ready" && rendition.url) return rendition.url;
    if (!response.ok || attributes?.status === "failed" || rendition?.status === "failed") {
      throw new Error(providerMessage(rendition?.error) || providerMessage(attributes?.error) || providerMessage(payload.error) || payload.message || "The renderer could not convert this dealership image.");
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error("The renderer timed out while converting an AVIF dealership image. Retry the render.");
}

export async function prepareRenderCompatibleImages(plan: ReturnType<typeof buildVerticalRenderPlan>, apiKey: string, stage: ShotstackStage) {
  const compatiblePlan = structuredClone(plan);
  type MutableRenderClip = { asset: { src?: string; [key: string]: unknown }; [key: string]: unknown };
  const clips = compatiblePlan.render.timeline.tracks.flatMap((track) => track.clips as unknown as MutableRenderClip[]);
  const sources = [...new Set(clips.map((clip) => clip.asset.src ?? "").filter((src) => needsImageRendition(src)))];
  if (sources.length === 0) return compatiblePlan;
  const replacements = new Map(await Promise.all(sources.map(async (src) => [src, await imageRendition(src, apiKey, stage)] as const)));
  for (const clip of clips) {
    if (clip.asset.src && replacements.has(clip.asset.src)) clip.asset.src = replacements.get(clip.asset.src)!;
  }
  return compatiblePlan;
}

export async function submitRender(plan: ReturnType<typeof buildVerticalRenderPlan>, env: LotSocialEnvironment) {
  const { apiKey, stage } = renderEnvironment(env);
  if (!apiKey) return { status: "awaiting_provider_setup", providerRenderId: "", errorMessage: "The production renderer is not connected yet." };

  const stages: ShotstackStage[] = stage === "v1" ? ["v1", "stage"] : ["stage", "v1"];
  let latestMessage = "The renderer rejected this job.";
  let rendererAuthRejected = false;
  for (const candidateStage of stages) {
    let compatiblePlan;
    try {
      compatiblePlan = await prepareRenderCompatibleImages(plan, apiKey, candidateStage);
    } catch (caught) {
      return { status: "provider_error", providerRenderId: "", errorMessage: caught instanceof Error ? caught.message : "The renderer could not prepare the dealership images." };
    }
    const response = await fetch(`https://api.shotstack.io/edit/${candidateStage}/render`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey },
      body: JSON.stringify(compatiblePlan.render),
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

function parseProviderRenderId(providerRenderId: string, env: LotSocialEnvironment) {
  const [maybeStage, ...rest] = providerRenderId.split(":");
  if ((maybeStage === "stage" || maybeStage === "v1") && rest.length) {
    return { stage: maybeStage, id: rest.join(":") };
  }
  return { stage: renderEnvironment(env).stage, id: providerRenderId };
}

export async function checkRender(providerRenderId: string, env: LotSocialEnvironment) {
  const { apiKey } = renderEnvironment(env);
  if (!apiKey) return null;
  const provider = parseProviderRenderId(providerRenderId, env);
  const response = await fetch(`https://api.shotstack.io/edit/${provider.stage}/render/${encodeURIComponent(provider.id)}`, {
    headers: { "x-api-key": apiKey },
  });
  const payload = await response.json() as {
    response?: { status?: string; url?: string; error?: unknown; message?: string };
    message?: string;
    error?: unknown;
  };
  if (!response.ok || !payload.response?.status) throw new Error(payload.response?.message ?? payload.message ?? "Unable to check the render status.");
  const providerStatus = payload.response.status;
  const normalizedStatus = providerStatus === "done" ? "completed" : providerStatus === "failed" ? "failed" : providerStatus === "preprocessing" ? "fetching" : providerStatus;
  return {
    status: normalizedStatus,
    outputUrl: payload.response.url ?? "",
    errorMessage: providerMessage(payload.response.error) || providerMessage(payload.error) || payload.response.message || payload.message || (normalizedStatus === "failed" ? "The renderer could not process one or more dealership images." : ""),
  };
}
