import { env } from "cloudflare:workers";
import type { CreativeProjectRecord } from "./creative";
import type { ImportedVehicleRecord } from "./vdp";

type RenderEnvironment = { SHOTSTACK_API_KEY?: string; SHOTSTACK_STAGE?: string };

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;",
  })[character] ?? character);
}

function vehicleName(vehicle: ImportedVehicleRecord) {
  return [vehicle.year, vehicle.make, vehicle.model, vehicle.trim].filter(Boolean).join(" ") || vehicle.title;
}

function priceLabel(value: string) {
  const amount = Number(value.replace(/[^\d.]/g, ""));
  return Number.isFinite(amount)
    ? `${new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(amount)} as listed`
    : value;
}

export function buildVerticalRenderPlan(project: CreativeProjectRecord, vehicle: ImportedVehicleRecord) {
  const images = JSON.parse(project.selected_images || "[]") as string[];
  const total = Math.max(15, project.duration_seconds);
  const endCardLength = Math.min(4, Math.max(3, total * 0.15));
  const imageLength = (total - endCardLength) / images.length;
  const name = vehicleName(vehicle);
  const pace = project.style === "energetic" ? "zoomIn" : project.style === "premium" ? "slideRight" : "zoomOut";
  const clips = images.map((src, index) => ({
    asset: { type: "image", src },
    start: Number((index * imageLength).toFixed(2)),
    length: Number((imageLength + (index < images.length - 1 ? 0.25 : 0)).toFixed(2)),
    fit: "crop",
    effect: pace,
    transition: { in: index === 0 ? "fade" : "carouselLeft", out: "fade" },
  }));
  const titleHtml = `<div><p>${escapeHtml(project.style.toUpperCase())}</p><h1>${escapeHtml(name)}</h1><strong>${escapeHtml(vehicle.price ? priceLabel(vehicle.price) : "Contact for current pricing")}</strong></div>`;
  const endCardHtml = `<div><p>${escapeHtml(project.end_card_cta)}</p><h1>${escapeHtml(project.end_card_name)}</h1><strong>${escapeHtml([project.end_card_phone, project.end_card_email].filter(Boolean).join("  ·  "))}</strong></div>`;
  const render = {
    timeline: {
      background: "#17242a",
      tracks: [
        { clips: [{ asset: { type: "html", html: endCardHtml, css: "div{font-family:Arial;color:#17242a;text-align:center;padding:560px 70px 0}p{font-size:38px}h1{font-size:80px;margin:18px 0}strong{font-size:28px}", width: 1080, height: 1920 }, start: Number((total - endCardLength).toFixed(2)), length: endCardLength }] },
        { clips: [{ asset: { type: "html", html: titleHtml, css: "div{font-family:Arial;color:white;padding:1280px 70px 0;text-shadow:0 3px 16px #000}p{display:inline-block;background:#c7ee5b;color:#17242a;padding:12px 18px;font-size:24px;font-weight:bold}h1{font-size:70px;line-height:1;margin:20px 0}strong{font-size:34px}", width: 1080, height: 1920 }, start: 0, length: Math.min(5, total - endCardLength) }] },
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
      fidelity: "Original dealership VDP photos only",
    },
  };
}

export async function submitRender(plan: ReturnType<typeof buildVerticalRenderPlan>) {
  const runtime = env as unknown as RenderEnvironment;
  const apiKey = runtime.SHOTSTACK_API_KEY?.trim();
  if (!apiKey) return { status: "awaiting_provider_setup", providerRenderId: "", errorMessage: "The production renderer is not connected yet." };

  const stage = runtime.SHOTSTACK_STAGE === "v1" ? "v1" : "stage";
  const response = await fetch(`https://api.shotstack.io/edit/${stage}/render`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey },
    body: JSON.stringify(plan.render),
  });
  const payload = await response.json() as { response?: { id?: string; message?: string }; message?: string };
  if (!response.ok || !payload.response?.id) {
    return { status: "provider_error", providerRenderId: "", errorMessage: payload.response?.message ?? payload.message ?? "The renderer rejected this job." };
  }
  return { status: "queued", providerRenderId: payload.response.id, errorMessage: "" };
}
