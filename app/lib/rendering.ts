import type { LotSocialEnvironment } from "./schema-bootstrap.ts";
import type { CreativeProjectRecord } from "./creative.ts";
import type { ImportedVehicleRecord } from "./vdp.ts";
import { getStoredProfilePhoto } from "./media.ts";

type RenderEnvironment = { SHOTSTACK_API_KEY?: string; SHOTSTACK_STAGE?: string };
type ShotstackStage = "stage" | "v1";
const INSPECTION_IMAGE_SCALE = 0.92;
const INGEST_POLL_ATTEMPTS = 30;
const HTML5_MARKUP_LIMIT = 1_000_000;

const VIDEO_TEMPLATES = {
  energetic: {
    name: "Fast Cuts",
    background: "#071116",
    wallpaperScale: 1.24,
    wallpaperOpacity: 0.46,
    tintOpacity: 0.86,
    tintCss: "div{width:1080px;height:1920px;background:linear-gradient(145deg,#071116 0%,#0d2025 58%,#31520f 100%)}",
    music: "https://shotstack-assets.s3-ap-southeast-2.amazonaws.com/music/freepd/motions.mp3",
    musicVolume: 0.22,
  },
  walkaround: {
    name: "Walkaround",
    background: "#17242a",
    wallpaperScale: 1.18,
    wallpaperOpacity: 0.38,
    tintOpacity: 0.94,
    tintCss: "div{width:1080px;height:1920px;background:linear-gradient(180deg,#071116 0%,#17242a 62%,#0d181c 100%)}",
    music: "https://shotstack-assets.s3-ap-southeast-2.amazonaws.com/music/freepd/advertising.mp3",
    musicVolume: 0.16,
  },
  premium: {
    name: "Premium",
    background: "#08090b",
    wallpaperScale: 1.12,
    wallpaperOpacity: 0.28,
    tintOpacity: 0.96,
    tintCss: "div{width:1080px;height:1920px;background:linear-gradient(155deg,#050607 0%,#111519 64%,#3a321d 100%)}",
    music: "https://shotstack-assets.s3-ap-southeast-2.amazonaws.com/music/freepd/fireworks.mp3",
    musicVolume: 0.13,
  },
} as const;

function videoTemplate(style: string) {
  return VIDEO_TEMPLATES[style as keyof typeof VIDEO_TEMPLATES] ?? VIDEO_TEMPLATES.walkaround;
}

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

export function buildVerticalRenderPlan(project: CreativeProjectRecord, vehicle: ImportedVehicleRecord, sourceOrigin: string | string[] = "", profilePhotoSource = project.end_card_photo_url) {
  const template = videoTemplate(project.style);
  const images = JSON.parse(project.selected_images || "[]") as string[];
  const renderImages = Array.isArray(sourceOrigin)
    ? sourceOrigin
    : sourceOrigin
    ? images.map((_src, index) => `${sourceOrigin.replace(/\/$/, "")}/api/render-source-images/${encodeURIComponent(project.id)}/${index}.jpg`)
    : images;
  const total = Math.max(15, project.duration_seconds);
  const endCardLength = Math.min(6, Math.max(5, total * 0.15));
  const imageLength = (total - endCardLength) / images.length;
  const timedImages = renderImages.map((src, index) => ({
    src,
    start: Number((index * imageLength).toFixed(2)),
    length: Number((imageLength + (index < images.length - 1 ? 0.25 : 0)).toFixed(2)),
  }));
  const wallpaperClips = timedImages.map(({ src, start, length }, index) => ({
    asset: { type: "image", src },
    start,
    length,
    fit: "crop",
    scale: template.wallpaperScale,
    position: "center",
    opacity: template.wallpaperOpacity,
    filter: "darken",
    transition: index === 0 ? { out: "fade" } : { in: "fade", out: "fade" },
  }));
  const wallpaperTintClips = timedImages.map(({ start, length }, index) => ({
    asset: { type: "html", html: "<div></div>", css: template.tintCss, width: 1080, height: 1920 },
    start,
    length,
    opacity: template.tintOpacity,
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
  const endCardPhoto = profilePhotoSource ? `<img class="profile-photo" src="${escapeHtml(profilePhotoSource)}" alt="">` : `<div class="photo-space"></div>`;
  const endCardHtml = `<div class="end-card"><div class="content">${endCardPhoto}<h1>${escapeHtml(project.end_card_name)}</h1><div class="contact">${endCardPhone}${endCardEmail}</div><p>${escapeHtml(project.end_card_cta)}</p><div class="disclaimer">${escapeHtml(disclaimer)}</div><div class="brand"><span></span><b>LotSocial</b></div></div></div>`;
  const endCardCss = "html,body{box-sizing:border-box;width:1080px;height:1920px;margin:0;padding:0;overflow:hidden;background:#071116}.end-card{box-sizing:border-box;width:1080px;height:1920px;padding:110px 120px 90px;font-family:Arial,Helvetica,sans-serif;color:white;text-align:center;background:linear-gradient(180deg,#071116 0%,#101f24 58%,#05090b 100%);overflow:hidden}.content{box-sizing:border-box;width:840px;height:1720px;display:grid;grid-template-rows:430px 160px 155px 140px 190px 1fr 90px;row-gap:22px;align-items:center;justify-items:center}.photo-space,.profile-photo{display:block;box-sizing:border-box;width:360px;height:420px;margin:0}.profile-photo{border:10px solid #c8ff43;border-radius:34px;object-fit:contain;object-position:center;background:#071116}.end-card h1{max-width:820px;max-height:150px;margin:0;font-size:58px;line-height:1.06;letter-spacing:-.03em;overflow:hidden;overflow-wrap:anywhere}.contact{max-width:820px;max-height:145px;margin:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;overflow:hidden}.phone{margin:0;color:#e8f1eb;font-size:34px;line-height:1.2;font-weight:850;overflow-wrap:anywhere}.email{margin:0;color:#e8f1eb;font-size:27px;line-height:1.25;font-weight:650;overflow-wrap:anywhere}.end-card p{max-width:820px;max-height:130px;margin:0;color:#c8ff43;font-size:36px;line-height:1.16;font-weight:900;letter-spacing:.02em;text-transform:uppercase;overflow:hidden;overflow-wrap:anywhere}.disclaimer{max-width:820px;max-height:180px;margin:0;color:#c8d2cd;font-size:24px;line-height:1.4;font-weight:650;overflow:hidden;overflow-wrap:anywhere}.brand{align-self:end;color:#c8ff43;white-space:nowrap}.brand span{display:inline-block;box-sizing:border-box;width:44px;height:66px;border:8px solid #c8ff43;border-right:0;vertical-align:middle}.brand b{display:inline-block;margin-left:13px;color:#c8ff43;font-size:34px;letter-spacing:.08em;vertical-align:middle}";
  const endCardStart = Number((total - endCardLength).toFixed(2));
  const render = {
    timeline: {
      background: template.background,
      tracks: [
        { clips: [{ asset: { type: "html5", html: endCardHtml, css: endCardCss }, start: endCardStart, length: endCardLength, width: 1080, height: 1920 }] },
        { clips },
        { clips: wallpaperTintClips },
        { clips: wallpaperClips },
        { clips: [{ asset: { type: "audio", src: template.music, volume: template.musicVolume, effect: "fadeInFadeOut" }, start: 0, length: total }] },
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
      template: template.name,
      music: "Included",
      fidelity: "Original dealership VDP photos only, template-specific motion, background, pacing and music, inspection-fit framing, and a branded salesperson end card with source-time pricing disclosure",
    },
  };
}

function providerMessage(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) return value.map(providerMessage).filter(Boolean).join("; ");
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of ["message", "error", "detail", "details", "reason"]) {
      const message = providerMessage(record[key]);
      if (message) return message;
    }
  }
  return "";
}

function base64Url(bytes: ArrayBuffer) {
  let binary = "";
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function buildSignedRenderSourceUrls(project: CreativeProjectRecord, env: LotSocialEnvironment, now = Date.now()) {
  const origin = env.LOTSOCIAL_RENDER_PROXY_ORIGIN?.trim().replace(/\/$/, "");
  const secret = env.LOTSOCIAL_RENDER_PROXY_SECRET?.trim();
  const images = JSON.parse(project.selected_images || "[]") as string[];
  if (images.length && (!origin || !secret)) throw new Error("The secure image relay is unavailable. No render was submitted or charged.");
  if (!origin || !secret) return [];
  const expires = Math.floor(now / 1000) + 60 * 60 * 2;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return Promise.all(images.map(async (source) => {
    const encoded = base64Url(new TextEncoder().encode(source).buffer);
    const message = `${expires}.${encoded}`;
    const signature = base64Url(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message)));
    return `${origin}/image.jpg?e=${expires}&u=${encoded}&s=${signature}`;
  }));
}

export async function validateSignedRenderSourceUrls(urls: string[]) {
  for (let index = 0; index < urls.length; index += 1) {
    const response = await fetch(urls[index], { headers: { Accept: "image/*" } });
    const contentType = response.headers.get("content-type") || "";
    if (!response.ok || !/^image\//i.test(contentType)) {
      throw new Error(`Selected photo ${index + 1} could not be prepared. Deselect that photo and try again. No render was submitted or charged.`);
    }
    await response.body?.cancel();
  }
}

function needsImageRendition(src: string) {
  try {
    return /\.avif$/i.test(new URL(src).pathname);
  } catch {
    return /\.avif(?:$|[?#])/i.test(src);
  }
}

function standardBase64(bytes: ArrayBuffer) {
  let binary = "";
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function profilePhotoId(source: string) {
  try {
    const pathname = new URL(source, "https://lotsocial.local").pathname;
    return pathname.match(/\/api\/profile-photos\/([a-f0-9-]{36}\.(?:jpg|jpeg|png|webp))$/i)?.[1] ?? "";
  } catch {
    return "";
  }
}

export async function inlineRenderProfilePhotos(plan: ReturnType<typeof buildVerticalRenderPlan>, env: LotSocialEnvironment) {
  const compatiblePlan = structuredClone(plan);
  type MutableHtmlClip = { asset: { type?: string; html?: string; [key: string]: unknown }; [key: string]: unknown };
  const clips = compatiblePlan.render.timeline.tracks.flatMap((track) => track.clips as unknown as MutableHtmlClip[]);
  const profilePattern = /src="([^"]*\/api\/profile-photos\/[a-f0-9-]{36}\.(?:jpg|jpeg|png|webp)(?:\?[^"#]*)?)"/gi;

  for (const clip of clips) {
    if (clip.asset.type !== "html5" || !clip.asset.html) continue;
    const matches = [...clip.asset.html.matchAll(profilePattern)];
    if (matches.length === 0) continue;
    let html = clip.asset.html;
    for (const match of matches) {
      const source = match[1];
      const photoId = profilePhotoId(source);
      const object = photoId ? await getStoredProfilePhoto(photoId, env) : null;
      if (!object) throw new Error("The saved end-card photo could not be loaded. Re-upload the photo and retry. No render was submitted or charged.");
      const contentType = object.httpMetadata?.contentType || ({ jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp" }[photoId.split(".").at(-1)?.toLowerCase() ?? ""] ?? "image/jpeg");
      const dataUri = `data:${contentType};base64,${standardBase64(await object.arrayBuffer())}`;
      html = html.replace(source, dataUri);
    }
    if (html.length > HTML5_MARKUP_LIMIT) {
      throw new Error("The saved end-card photo is too large for the video renderer. Re-upload the photo and retry. No render was submitted or charged.");
    }
    clip.asset.html = html;
  }
  return compatiblePlan;
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
  type MutableRenderClip = { asset: { type?: string; src?: string; [key: string]: unknown }; [key: string]: unknown };
  const clips = compatiblePlan.render.timeline.tracks.flatMap((track) => track.clips as unknown as MutableRenderClip[]);
  const sources = [...new Set(
    clips
      .filter((clip) => clip.asset.type === "image")
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
  let providerPlan;
  try {
    providerPlan = await inlineRenderProfilePhotos(plan, env);
  } catch (caught) {
    return { status: "provider_error", providerRenderId: "", errorMessage: caught instanceof Error ? caught.message : "The renderer could not prepare the saved end-card photo." };
  }
  for (const candidateStage of stages) {
    let compatiblePlan;
    try {
      compatiblePlan = await prepareRenderCompatibleImages(providerPlan, apiKey, candidateStage, Boolean(options.convertAllImages));
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
  const response = await fetch(`https://api.shotstack.io/edit/${provider.stage}/render/${encodeURIComponent(provider.id)}?data=true&merged=true`, {
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
