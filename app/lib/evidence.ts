import { database, ensureLotSocialSchema } from "./schema-bootstrap.ts";
import type { LotSocialEnvironment } from "./schema-bootstrap.ts";
import type { ExtractedVehicle, ImportedVehicleRecord } from "./vdp.ts";

export const PRICING_DISCLAIMER_VERSION = "2026-09-14-v1";
export const TERMS_VERSION = "2026-09-14-v2";
export const PRICING_DISCLAIMER_TEMPLATE =
  "Pricing and availability as shown on the dealer's website on <date, time, TZ>; subject to change. Confirm current price with the dealership.";

export type ImportEvidenceRecord = {
  id: string;
  vehicle_id: string;
  associate_email: string;
  dealership_tenant: string;
  source_url: string;
  source_host: string;
  captured_at: string;
  content_sha256: string;
  html_storage_key: string;
  screenshot_storage_key: string;
  screenshot_status: string;
  price_at_capture: string;
  currency: string;
  vin_at_capture: string;
  stock_at_capture: string;
  title_at_capture: string;
  purpose_project_id: string | null;
  purpose_note: string;
  source_type: string;
  content_type: string;
  storage_bytes: number;
};

export async function recordImportEvidence(input: {
  vehicle: ImportedVehicleRecord;
  extracted: ExtractedVehicle;
  associateEmail: string;
  dealershipTenant: string;
  purposeNote: string;
}, env: LotSocialEnvironment) {
  if (!env.MEDIA) throw new Error("VDP evidence storage is unavailable, so this import was not saved.");
  const content = input.extracted.evidenceContent;
  if (!content) throw new Error("The source page could not be preserved, so this import was not saved.");
  const contentType = input.extracted.evidenceContentType || "text/html; charset=utf-8";
  const bytes = new TextEncoder().encode(content);
  if (bytes.byteLength > 3_000_000) throw new Error("The source evidence is too large to preserve safely.");

  const id = crypto.randomUUID();
  const capturedAt = new Date().toISOString();
  const owner = safeSegment(input.dealershipTenant || input.extracted.sourceHost);
  const prefix = `evidence/${owner}/${input.vehicle.id}/${id}`;
  const extension = contentType.includes("json") ? "json" : "html";
  const htmlStorageKey = `${prefix}/source.${extension}`;
  const contentSha256 = await sha256Hex(bytes);
  await env.MEDIA.put(htmlStorageKey, bytes, {
    httpMetadata: { contentType, cacheControl: "private, no-store" },
    customMetadata: { evidenceId: id, contentSha256, capturedAt, vehicleId: input.vehicle.id },
  });

  const screenshot = await captureScreenshot(input.extracted.sourceUrl, env);
  let screenshotStorageKey = "";
  let screenshotStatus = "unavailable";
  if (screenshot) {
    screenshotStorageKey = `${prefix}/page.png`;
    await env.MEDIA.put(screenshotStorageKey, screenshot, {
      httpMetadata: { contentType: "image/png", cacheControl: "private, no-store" },
      customMetadata: { evidenceId: id, capturedAt, vehicleId: input.vehicle.id },
    });
    screenshotStatus = "captured";
  }

  await ensureLotSocialSchema(env);
  await database(env, "VDP evidence").prepare(`INSERT INTO import_evidence (
      id, vehicle_id, associate_email, dealership_tenant, source_url, source_host, captured_at,
      content_sha256, html_storage_key, screenshot_storage_key, screenshot_status, price_at_capture,
      currency, vin_at_capture, stock_at_capture, title_at_capture, purpose_project_id, purpose_note,
      source_type, content_type, storage_bytes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)`)
    .bind(
      id, input.vehicle.id, input.associateEmail, input.dealershipTenant, input.extracted.sourceUrl,
      input.extracted.sourceHost, capturedAt, contentSha256, htmlStorageKey, screenshotStorageKey,
      screenshotStatus, input.extracted.price, input.extracted.currency, input.extracted.vin,
      input.extracted.stockNumber, input.extracted.title, input.purposeNote, input.vehicle.source_type,
      contentType, bytes.byteLength,
    ).run();
  return { id, capturedAt, contentSha256, htmlStorageKey, screenshotStorageKey, screenshotStatus };
}

export async function listEvidenceForVehicle(vehicleId: string, env: LotSocialEnvironment) {
  await ensureLotSocialSchema(env);
  return (await database(env, "VDP evidence").prepare(
    "SELECT * FROM import_evidence WHERE vehicle_id = ? ORDER BY captured_at DESC",
  ).bind(vehicleId).all<ImportEvidenceRecord>()).results;
}

export async function getEvidenceById(id: string, env: LotSocialEnvironment) {
  await ensureLotSocialSchema(env);
  return database(env, "VDP evidence").prepare("SELECT * FROM import_evidence WHERE id = ? LIMIT 1")
    .bind(id).first<ImportEvidenceRecord>();
}

export async function getStoredEvidence(storageKey: string, env: LotSocialEnvironment) {
  if (!env.MEDIA) throw new Error("VDP evidence storage is unavailable.");
  return env.MEDIA.get(storageKey);
}

export async function createEvidenceArtifactToken(id: string, kind: "source" | "screenshot", expiresAt: number, env: LotSocialEnvironment) {
  if (!env.ENFORCEMENT_API_KEY) throw new Error("Evidence-link signing is not configured.");
  const message = `${id}.${kind}.${expiresAt}`;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.ENFORCEMENT_API_KEY), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return base64Url(new Uint8Array(signature));
}

export async function verifyEvidenceArtifactToken(id: string, kind: "source" | "screenshot", expiresAt: number, token: string, env: LotSocialEnvironment) {
  if (!token || expiresAt < Math.floor(Date.now() / 1000) || expiresAt > Math.floor(Date.now() / 1000) + 3600) return false;
  const expected = await createEvidenceArtifactToken(id, kind, expiresAt, env).catch(() => "");
  if (expected.length !== token.length) return false;
  let mismatch = 0;
  for (let index = 0; index < expected.length; index += 1) mismatch |= expected.charCodeAt(index) ^ token.charCodeAt(index);
  return mismatch === 0;
}

async function captureScreenshot(url: string, env: LotSocialEnvironment) {
  if (!env.BROWSER) return null;
  try {
    const response = await env.BROWSER.quickAction("snapshot", {
      url,
      screenshotOptions: { fullPage: true, type: "png" },
      gotoOptions: { waitUntil: "networkidle0", timeout: 20_000 },
    });
    if (!response.ok) return null;
    const payload = await response.json() as { result?: { screenshot?: string } };
    const encoded = payload.result?.screenshot ?? "";
    if (!encoded) return null;
    const binary = Uint8Array.from(atob(encoded.replace(/^data:image\/png;base64,/, "")), (char) => char.charCodeAt(0));
    return binary.byteLength <= 5_000_000 ? binary : null;
  } catch (error) {
    console.warn("vdp_evidence_screenshot_unavailable", { message: error instanceof Error ? error.message : "Unknown screenshot failure" });
    return null;
  }
}

async function sha256Hex(bytes: Uint8Array) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function safeSegment(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9.-]+/g, "-").replace(/^-|-$/g, "").slice(0, 100) || "unknown-dealership";
}

function base64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
