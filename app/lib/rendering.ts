import type { LotSocialEnvironment } from "./schema-bootstrap.ts";
import type { CreativeProjectRecord } from "./creative.ts";
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

function capturedAtLabel(value: string) {
  const parsed = new Date(value.replace(" ", "T") + (/Z$|[+-]\d\d:\d\d$/.test(value) ? "" : "Z"));
  if (!Number.isFinite(parsed.getTime())) return "the recorded capture time";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  }).format(parsed);
}

function styleTreatment(style: string, index: number) {
  if (style === "energetic") {
    return {
      effect: ["zoomInFast", "slideLeftFast", "zoomOutFast", "slideRightFast"][index % 4],
      transition: index === 0
        ? { out: "fadeFast" }
        : { in: index % 2 ? "wipeLeftFast" : "wipeRightFast", out: "fadeFast" },
      scale: 0.96,
    };
  }
  if (style === "premium") {
    return {
      effect: index % 2 ? "zoomOutSlow" : "zoomInSlow",
      transition: index === 0 ? { out: "fadeSlow" } : { in: "fadeSlow", out: "fadeSlow" },
      scale: 0.88,
    };
  }
  return {
    effect: index % 2 ? "slideRightSlow" : "slideLeftSlow",
    transition: index === 0 ? { out: "fade" } : { in: "fade", out: "fade" },
    scale: INSPECTION_IMAGE_SCALE,
  };
}

export function buildVerticalRenderPlan(project: CreativeProjectRecord, vehicle: ImportedVehicleRecord) {
  const images = JSON.parse(project.selected_images || "[]") as string[];
  const total = Math.max(15, project.duration_seconds);
  const endCardLength = Math.min(6, Math.max(5, total * 0.15));
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
  const clips = timedImages.map(({ src, start, length }, index) => {
    const treatment = styleTreatment(project.style, index);
    return {
      asset: { type: "image", src },
      start,
      length,
      fit: "contain",
      scale: treatment.scale,
      position: "center",
      effect: treatment.effect,
      transition: treatment.transition,
    };
  });
  const endCardPhone = project.end_card_phone ? `<div class="phone">${escapeHtml(project.end_card_phone)}</div>` : "";
  const endCardEmail = project.end_card_email ? `<div class="email">${escapeHtml(project.end_card_email)}</div>` : "";
  const disclaimer = `Pricing and availability as shown on the dealer's website on ${capturedAtLabel(vehicle.imported_at)}; subject to change. Confirm current price with the dealership.`;
  const endCardHtml = `<div class="end-card"><div class="content"><div class="photo-space"></div><h1>${escapeHtml(project.end_card_name)}</h1><div class="contact">${endCardPhone}${endCardEmail}</div><p>${escapeHtml(project.end_card_cta)}</p><div class="disclaimer">${escapeHtml(disclaimer)}</div><div class="brand"><span></span><b>LotSocial</b></div></div></div>`;
  const endCardCss = "html,body{margin:0}.end-card{box-sizing:border-box;position:relative;width:1080px;height:1920px;font-family:Arial,Helvetica,sans-serif;color:white;text-align:center;background:linear-gradient(180deg,#071116 0%,#101f24 58%,#05090b 100%);overflow:hidden}.content{position:absolute;left:155px;right:155px;top:160px;bottom:95px}.photo-space{height:390px}.end-card h1{max-width:770px;margin:0 auto 52px;font-size:58px;line-height:1.05;letter-spacing:-.03em;overflow-wrap:anywhere}.contact{max-width:770px;margin:0 auto 68px}.phone{display:block;margin:0 auto 24px;color:#e8f1eb;font-size:34px;line-height:1.25;font-weight:850;overflow-wrap:anywhere}.email{display:block;margin:0 auto;color:#e8f1eb;font-size:27px;line-height:1.3;font-weight:650;overflow-wrap:anywhere}.end-card p{max-width:770px;margin:0 auto 95px;color:#c8ff43;font-size:36px;line-height:1.18;font-weight:900;letter-spacing:.02em;text-transform:uppercase;overflow-wrap:anywhere}.disclaimer{max-width:790px;margin:0 auto;color:#c8d2cd;font-size:24px;line-height:1.42;font-weight:650;overflow-wrap:anywhere}.brand{position:absolute;left:0;right:0;bottom:0;color:#c8ff43}.brand span{display:inline-block;box-sizing:border-box;width:44px;height:66px;border:8px solid #c8ff43;border-right:0;vertical-align:middle}.brand b{display:inline-block;margin-left:13px;color:#c8ff43;font-size:34px;letter-spacing:.08em;vertical-align:middle}";
  const endCardStart = Number((total - endCardLength).toFixed(2));
  const profileClips = project.end_card_photo_url ? [{
    asset: { type: "image", src: project.end_card_photo_url },
    start: endCardStart,
    length: endCardLength,
    fit: "crop",
    width: 300,
    height: 300,
    position: "top",
    offset: { x: 0, y: -0.15 },
    transition: { in: "fade", out: "fade" },
  }] : [];
  const render = {
    timeline: {
      background: "#17242a",
      tracks: [
        ...(profileClips.length ? [{ clips: profileClips }] : []),
        { clips: [{ asset: { type: "html", html: endCardHtml, css: endCardCss, width: 1080, height: 1920 }, start: endCardStart, length: endCardLength }] },
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
      fidelity: "Original dealership VDP photos only, style-specific motion, inspection-fit framing with darker same-image wallpaper fill, and a branded salesperson end card with source-time pricing disclosure",
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

export async function prepareRenderCompatibleImages(
  plan: ReturnType<typeof buildVerticalRenderPlan>,
  apiKey: string,
  stage: ShotstackStage,
  convertAllImages = false,
) {
  const compatiblePlan = structuredClone(plan);
  type MutableRenderClip = { asset: { src?: string; [key: string]: unknown }; [key: string]: unknown };
  const clips = compatiblePlan.render.timeline.tracks.flatMap((track) => track.clips as unknown as MutableRenderClip[]);
  const sources = [...new Set(
    clips
      .map((clip) => clip.asset.src ?? "")
      .filter((src) => src && (convertAllImages || needsImageRendition(src))),
  )];
  if (sources.length === 0) return compatiblePlan;
  const replacements = new Map(await Promise.all(sources.map(async (src) => [src, await imageRendition(src, apiKey, stage)] as const)));
  for (const clip of clips) {
    if (clip.asset.src && replacements.has(clip.asset.src)) clip.asset.src = replacements.get(clip.asset.src)!;
  }
  return compatiblePlan;
}

export async function submitRender(
  plan: ReturnType<typeof buildVerticalRenderPlan>,
  env: LotSocialEnvironment,
  options: { convertAllImages?: boolean } = {},
) {
  const { apiKey, stage } = renderEnvironment(env);
  if (!apiKey) return { status: "awaiting_provider_setup", providerRenderId: "", errorMessage: "The production renderer is not connected yet." };

  const stages: ShotstackStage[] = stage === "v1" ? ["v1", "stage"] : ["stage", "v1"];
  let latestMessage = "The renderer rejected this job.";
  let rendererAuthRejected = false;
  for (const candidateStage of stages) {
    let compatiblePlan;
    try {
      compatiblePlan = await prepareRenderCompatibleImages(plan, apiKey, candidateStage, Boolean(options.convertAllImages));
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
