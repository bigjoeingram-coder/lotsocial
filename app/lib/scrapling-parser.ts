import type { LotSocialEnvironment } from "./schema-bootstrap.ts";

export const SCRAPLING_EXTRACTION_VERSION = "scrapling-pilot-0.4.15-v1";
export const SCRAPLING_TIMEOUT_MS = 10_000;
export const SCRAPLING_MAX_REQUEST_BYTES = 3_000_000;
export const SCRAPLING_MAX_RESPONSE_BYTES = 256_000;

type Evidence = { selector: string | null; rawValue: string | null };

export type ScraplingVehicleCandidate = {
  title: string | null;
  vin: string | null;
  stockNumber: string | null;
  year: string | null;
  make: string | null;
  model: string | null;
  trim: string | null;
  price: string | null;
  currency: string | null;
  description: string | null;
  imageUrls: string[];
  facts: Record<string, string>;
};

export type ScraplingProposal = {
  extractionVersion: typeof SCRAPLING_EXTRACTION_VERSION;
  adaptiveMatchUsed: boolean;
  vehicle: ScraplingVehicleCandidate;
  evidence: Record<string, Evidence | Evidence[]>;
  warnings: string[];
};

type InvokeOptions = {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

function isEvidence(value: unknown): value is Evidence {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return (item.selector === null || typeof item.selector === "string")
    && (item.rawValue === null || typeof item.rawValue === "string");
}

function nullableString(value: unknown) {
  return value === null || typeof value === "string";
}

export function parseScraplingProposal(value: unknown): ScraplingProposal | null {
  if (!value || typeof value !== "object") return null;
  const proposal = value as Record<string, unknown>;
  if (proposal.extractionVersion !== SCRAPLING_EXTRACTION_VERSION || typeof proposal.adaptiveMatchUsed !== "boolean") return null;
  if (!Array.isArray(proposal.warnings) || proposal.warnings.some((item) => typeof item !== "string")) return null;
  if (!proposal.vehicle || typeof proposal.vehicle !== "object" || !proposal.evidence || typeof proposal.evidence !== "object") return null;
  const vehicle = proposal.vehicle as Record<string, unknown>;
  for (const key of ["title", "vin", "stockNumber", "year", "make", "model", "trim", "price", "currency", "description"]) {
    if (!nullableString(vehicle[key])) return null;
  }
  if (!Array.isArray(vehicle.imageUrls) || vehicle.imageUrls.some((item) => typeof item !== "string")) return null;
  if (!vehicle.facts || typeof vehicle.facts !== "object" || Array.isArray(vehicle.facts)
    || Object.values(vehicle.facts as Record<string, unknown>).some((item) => typeof item !== "string")) return null;
  for (const item of Object.values(proposal.evidence as Record<string, unknown>)) {
    if (Array.isArray(item) ? item.some((entry) => !isEvidence(entry)) : !isEvidence(item)) return null;
  }
  return proposal as ScraplingProposal;
}

function sanitizedSourceUrl(value: URL) {
  const clean = new URL(value.href);
  clean.search = "";
  clean.hash = "";
  return clean.href;
}

function isPublicSourceUrl(value: URL) {
  if (!["http:", "https:"].includes(value.protocol) || value.username || value.password || (value.port && !["80", "443"].includes(value.port))) return false;
  const host = value.hostname.toLowerCase().replace(/\.$/, "");
  if (!host || host === "localhost" || host.endsWith(".local") || host.endsWith(".internal") || host.includes(":")) return false;
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)?.slice(1).map(Number);
  if (!ipv4) return true;
  if (ipv4.some((part) => part > 255)) return false;
  return !(ipv4[0] === 0 || ipv4[0] === 10 || ipv4[0] === 127 || (ipv4[0] === 169 && ipv4[1] === 254)
    || (ipv4[0] === 172 && ipv4[1] >= 16 && ipv4[1] <= 31) || (ipv4[0] === 192 && ipv4[1] === 168));
}

function normalizedReason(error: unknown) {
  if (error instanceof DOMException && error.name === "AbortError") return "timeout";
  if (error instanceof Error && /response.*large/i.test(error.message)) return "response_too_large";
  if (error instanceof SyntaxError) return "malformed_json";
  return "unavailable";
}

export async function invokeScraplingParser(
  html: string,
  sourceUrl: URL,
  expectedVin: string,
  env: LotSocialEnvironment,
  options: InvokeOptions = {},
): Promise<ScraplingProposal | null> {
  if (env.LOTSOCIAL_SCRAPLING_ENABLED?.toLowerCase() !== "true") return null;
  if (!isPublicSourceUrl(sourceUrl)) {
    console.warn("LotSocial Scrapling pilot", { host: "private", outcome: "skipped_non_public_source" });
    return null;
  }
  const endpoint = env.LOTSOCIAL_SCRAPLING_URL?.trim();
  const token = env.LOTSOCIAL_SCRAPLING_TOKEN?.trim();
  if (!endpoint || !token) {
    console.warn("LotSocial Scrapling pilot", { host: sourceUrl.hostname, outcome: "skipped_configuration" });
    return null;
  }
  const body = JSON.stringify({
    sourceUrl: sanitizedSourceUrl(sourceUrl),
    html,
    expectedVin: expectedVin || undefined,
  });
  if (new TextEncoder().encode(body).byteLength > SCRAPLING_MAX_REQUEST_BYTES) {
    console.warn("LotSocial Scrapling pilot", { host: sourceUrl.hostname, outcome: "skipped_request_too_large" });
    return null;
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? SCRAPLING_TIMEOUT_MS);
  const startedAt = Date.now();
  try {
    const response = await (options.fetchImpl ?? fetch)(new URL("/extract/v1", endpoint), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body,
      signal: controller.signal,
      redirect: "error",
    });
    const declared = Number(response.headers.get("content-length") ?? "0");
    if (declared > SCRAPLING_MAX_RESPONSE_BYTES) throw new Error("Scrapling response too large");
    if (!response.ok) {
      console.warn("LotSocial Scrapling pilot", { host: sourceUrl.hostname, outcome: "rejected", status: response.status, elapsedMs: Date.now() - startedAt });
      return null;
    }
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > SCRAPLING_MAX_RESPONSE_BYTES) throw new Error("Scrapling response too large");
    const proposal = parseScraplingProposal(JSON.parse(text));
    console.warn("LotSocial Scrapling pilot", {
      host: sourceUrl.hostname,
      outcome: proposal ? "proposed" : "invalid_schema",
      elapsedMs: Date.now() - startedAt,
      fieldCount: proposal ? Object.keys(proposal.evidence).length : 0,
      adaptiveMatchUsed: proposal?.adaptiveMatchUsed ?? false,
      version: proposal?.extractionVersion ?? "invalid",
    });
    return proposal;
  } catch (error) {
    console.warn("LotSocial Scrapling pilot", { host: sourceUrl.hostname, outcome: normalizedReason(error), elapsedMs: Date.now() - startedAt });
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
