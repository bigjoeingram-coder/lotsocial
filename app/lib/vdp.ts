import { database, ensureLotSocialSchema } from "./schema-bootstrap.ts";
import type { LotSocialEnvironment } from "./schema-bootstrap.ts";
import { incrementDailyLimit } from "./limits.ts";

export type ImportedVehicleRecord = {
  id: string;
  associate_email: string;
  source_url: string;
  source_host: string;
  title: string;
  vin: string;
  stock_number: string;
  year: string;
  make: string;
  model: string;
  trim: string;
  price: string;
  currency: string;
  description: string;
  image_urls: string;
  facts: string;
  source_type: string;
  authorization_certified_at: string;
  imported_at: string;
  updated_at: string;
};

export function normalizeVehicleYear(value: string) {
  return value.match(/\b(20\d{2}|19\d{2})\b/)?.[1] ?? value.trim();
}

export type ExtractedVehicle = {
  sourceUrl: string;
  sourceHost: string;
  title: string;
  vin: string;
  stockNumber: string;
  year: string;
  make: string;
  model: string;
  trim: string;
  price: string;
  currency: string;
  description: string;
  imageUrls: string[];
  facts: Record<string, string>;
};

export type ExtractionTrace = {
  fallback: "none" | "bright_data" | "listing_guess";
  brightDataUsed: boolean;
  budgetSkipped: boolean;
  networkTimedOut: boolean;
  notice: string;
};

export type ExtractionContext = {
  associateEmail: string;
  trace: ExtractionTrace;
};

export function createExtractionTrace(): ExtractionTrace {
  return { fallback: "none", brightDataUsed: false, budgetSkipped: false, networkTimedOut: false, notice: "" };
}

export async function reserveBrightDataBudget(env: LotSocialEnvironment, associateEmail: string) {
  const associate = await incrementDailyLimit(env, "brightdata_associate", associateEmail);
  const global = associate.allowed ? await incrementDailyLimit(env, "brightdata_global", "all-associates") : null;
  return { allowed: associate.allowed && Boolean(global?.allowed), associate, global };
}

const IMPORT_DEADLINE_MS = 36_000;
const DIRECT_FETCH_MS = 8_000;
const READER_FETCH_MS = 14_000;
const BRIGHTDATA_FETCH_MS = 25_000;
const MAX_READER_ATTEMPTS = 12;

async function ensureVdpSchema(env: LotSocialEnvironment) {
  return ensureLotSocialSchema(env);
}

function validatePublicUrl(value: string) {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("Enter a complete public VDP URL."); }
  if (!["http:", "https:"].includes(url.protocol) || (url.port && !["80", "443"].includes(url.port))) throw new Error("Only public HTTP or HTTPS vehicle pages are supported.");
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal") || host.includes(":")) throw new Error("Private network addresses are not supported.");
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)?.slice(1).map(Number);
  if (ipv4 && (ipv4[0] === 10 || ipv4[0] === 127 || ipv4[0] === 0 || (ipv4[0] === 169 && ipv4[1] === 254) || (ipv4[0] === 172 && ipv4[1] >= 16 && ipv4[1] <= 31) || (ipv4[0] === 192 && ipv4[1] === 168))) throw new Error("Private network addresses are not supported.");
  url.hash = "";
  return url;
}

const TRACKING_QUERY_PARAMETER = /^(?:utm_.+|gclid|fbclid)$/i;

export function normalizeSourceUrl(value: string) {
  const url = validatePublicUrl(value);
  for (const key of Array.from(url.searchParams.keys())) {
    if (TRACKING_QUERY_PARAMETER.test(key)) url.searchParams.delete(key);
  }
  url.searchParams.sort();
  if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, "");
  return url.href;
}

export function sourceUrlVariants(value: string) {
  const raw = validatePublicUrl(value);
  const canonical = normalizeSourceUrl(raw.href);
  const variants = new Set([canonical, raw.href]);
  const toggleTrailingSlash = new URL(canonical);
  if (toggleTrailingSlash.pathname !== "/") {
    toggleTrailingSlash.pathname = toggleTrailingSlash.pathname.endsWith("/")
      ? toggleTrailingSlash.pathname.slice(0, -1)
      : `${toggleTrailingSlash.pathname}/`;
    variants.add(toggleTrailingSlash.href);
  }
  return Array.from(variants);
}

function textValue(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") return String(value).trim();
  if (value && typeof value === "object" && "name" in value) return textValue((value as { name?: unknown }).name);
  return "";
}

function flattenJsonLd(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.flatMap(flattenJsonLd);
  if (!value || typeof value !== "object") return [];
  const object = value as Record<string, unknown>;
  return [object, ...flattenJsonLd(object["@graph"]), ...flattenJsonLd(object.itemListElement)];
}

function typesOf(node: Record<string, unknown>) {
  const value = node["@type"];
  return (Array.isArray(value) ? value : [value]).filter((item): item is string => typeof item === "string").map((item) => item.toLowerCase());
}

function meta(html: string, key: string) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']+)["'][^>]*>`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${escaped}["'][^>]*>`, "i"),
  ];
  return patterns.map((pattern) => html.match(pattern)?.[1] ?? "").find(Boolean) ?? "";
}

function decodeEntities(value: string) {
  return value.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+/g, " ").trim();
}

export function normalizeListedPrice(value: unknown) {
  const raw = textValue(value);
  const match = raw.match(/(?:USD\s*)?\$?\s*([\d,]+(?:\.\d{1,2})?)/i);
  if (!match) return "";
  const amount = Number(match[1].replace(/,/g, ""));
  return Number.isFinite(amount) && amount >= 1000 ? String(amount) : "";
}

function attributeValue(html: string, attribute: string, value: string, target: string) {
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const tag = html.match(new RegExp(`<[^>]+${attribute}=["']${escaped}["'][^>]*>`, "i"))?.[0] ?? "";
  return tag.match(new RegExp(`${target}=["']([^"']+)["']`, "i"))?.[1] ?? "";
}

function resolveImage(value: unknown, baseUrl: URL): string[] {
  const raw = Array.isArray(value) ? value : [value];
  return raw.flatMap((item) => {
    if (typeof item === "string") return [item];
    if (item && typeof item === "object") return [textValue((item as Record<string, unknown>).url) || textValue((item as Record<string, unknown>).contentUrl)];
    return [];
  }).filter(Boolean).map((item) => { try { return new URL(decodeEntities(item), baseUrl).href; } catch { return ""; } }).filter(Boolean);
}

function imageUrlsFromTag(tag: string, baseUrl: URL) {
  const direct = Array.from(tag.matchAll(/(?:src|data-src|data-lazy-src)=["']([^"']+)["']/gi)).flatMap((match) => resolveImage(match[1], baseUrl));
  const sourceSets = Array.from(tag.matchAll(/(?:srcset|data-srcset)=["']([^"']+)["']/gi)).flatMap((match) =>
    match[1].split(",").flatMap((candidate) => resolveImage(candidate.trim().split(/\s+/)[0], baseUrl))
  );
  return [...direct, ...sourceSets];
}

function usableImageUrl(url: string) {
  try {
    const parsed = new URL(url);
    if (!(["http:", "https:"] as string[]).includes(parsed.protocol)) return false;
    if (/\.(?:svg|ico|gif|pdf)(?:\?|$)/i.test(parsed.pathname)) return false;
    return !/(?:logo|icon|avatar|pixel|badge|spacer|tracking|favicon|loader|placeholder)/i.test(url);
  } catch {
    return false;
  }
}

function createDeadline(durationMs = IMPORT_DEADLINE_MS) {
  return { expiresAt: Date.now() + durationMs };
}

function timeoutFor(deadline: { expiresAt: number }, requestedMs: number) {
  const remaining = deadline.expiresAt - Date.now();
  if (remaining <= 0) throw new Error("LotSocial could not scrape that VDP before the dealer page timed out.");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.min(remaining, requestedMs));
  return { signal: controller.signal, cleanup: () => clearTimeout(timeout) };
}

export function isCloudflareChallenge(html: string, headers?: Headers) {
  const headerText = [
    headers?.get("cf-mitigated"),
    headers?.get("cf-ray"),
    headers?.get("server"),
  ].filter(Boolean).join(" ").toLowerCase();
  if (headerText.includes("challenge") || headerText.includes("cloudflare")) return true;
  return /(?:cf-chl|cdn-cgi\/challenge-platform|just a moment|attention required|checking if the site connection is secure|cf-ray)/i.test(html);
}

function markdownContent(markdown: string) {
  return markdown.match(/Markdown Content:\s*([\s\S]*)$/i)?.[1] ?? markdown;
}

function isReaderChallengeMarkdown(markdown: string) {
  return /Title:\s*(?:Just a moment|Attention Required)/i.test(markdown)
    || /Warning:\s*This page maybe requiring CAPTCHA/i.test(markdown)
    || /(?:cf-chl|cdn-cgi\/challenge-platform|checking if the site connection is secure)/i.test(markdown);
}

export function vinFromUrl(url: URL) {
  return url.pathname.match(/\b[A-HJ-NPR-Z0-9]{17}\b/i)?.[0]?.toUpperCase() ?? "";
}

function vehicleSlugParts(url: URL) {
  const segment = url.pathname.split("/").filter(Boolean).find((part) => part.startsWith("new-") || part.startsWith("used-") || part.startsWith("certified-")) ?? "";
  return segment.split("-").filter(Boolean);
}

// Makes whose slug is two words: the model is the token after BOTH words.
const TWO_WORD_MAKES = new Set(["land", "range", "mercedes", "alfa", "aston", "rolls"]);
const SLUG_CONDITION_WORDS = new Set(["new", "used", "certified", "pre", "owned", "preowned", "cpo"]);

// Rock 6 (I-18): the make/model guess no longer depends on a hardcoded make list — a
// list silently produced zero model paths for Ram, Jeep, Chrysler, Dodge, and every
// other unlisted brand. The slug shape is stable across dealer platforms:
// <condition>-<year>-<make>-<model>-<trim...>-<vin?>. Anchor on the year; fall back to
// the first token after the condition words when a slug has no year.
export function slugMakeAndModel(url: URL) {
  const parts = vehicleSlugParts(url).map((part) => part.toLowerCase());
  const yearIndex = parts.findIndex((part) => /^(?:19|20)\d{2}$/.test(part));
  let makeIndex = yearIndex >= 0 ? yearIndex + 1 : parts.findIndex((part) => !SLUG_CONDITION_WORDS.has(part) && !/^\d+$/.test(part));
  if (makeIndex < 0 || makeIndex >= parts.length) return { make: "", model: "" };
  let make = parts[makeIndex];
  if (TWO_WORD_MAKES.has(make) && parts[makeIndex + 1]) {
    make = `${make}-${parts[makeIndex + 1]}`;
    makeIndex += 1;
  }
  const model = parts[makeIndex + 1] ?? "";
  if (!model || /^[A-HJ-NPR-Z0-9]{17}$/i.test(model)) return { make, model: "" };
  return { make, model };
}

export function candidateInventoryPaths(url: URL) {
  const vin = vinFromUrl(url);
  const { model } = slugMakeAndModel(url);
  const paths = new Set<string>();
  if (vin) paths.add(`/inventory/?q=${encodeURIComponent(vin)}`);
  paths.add("/llm/inventory/");
  if (model) paths.add(`/new-vehicles/${model}/`);
  [
    "/new-vehicles/crossovers-suvs/",
    "/new-vehicles/suvs/",
    "/new-vehicles/",
    "/used-vehicles/",
  ].forEach((path) => paths.add(path));
  return Array.from(paths).map((path) => new URL(path, url.origin));
}

function fallbackVehicleSurfaces(url: URL) {
  return [url, ...candidateInventoryPaths(url)];
}

function readerUrls(targetUrl: URL) {
  const hrefWithoutProtocol = targetUrl.href.replace(/^https?:\/\//i, "");
  const originPath = `${targetUrl.hostname}${targetUrl.pathname}${targetUrl.search}`;
  return [
    `https://r.jina.ai/http://${hrefWithoutProtocol}`,
    `https://r.jina.ai/http://${originPath}`,
    // This nested reader shape is intentionally retained because it returned real
    // Dealer Inspire inventory markdown for Newport Lexus and Newport Beach Maserati.
    `https://r.jina.ai/http://r.jina.ai/http://${targetUrl.href}`,
  ];
}

function markdownField(block: string, label: string) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return decodeEntities(block.match(new RegExp(`${escaped}:\\s*([^\\n]+)`, "i"))?.[1] ?? "");
}

function vehicleEvidenceIndex(content: string, vin: string) {
  const escapedVin = vin.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`\\bVIN\\s*:?\\s*${escapedVin}\\b`, "i"),
    new RegExp(`\\b${escapedVin}\\s+STOCK\\s*:`, "i"),
    new RegExp(`/ ${escapedVin} /`.replace(/\s/g, ""), "i"),
  ];
  return patterns.map((pattern) => content.search(pattern)).filter((index) => index >= 0).sort((a, b) => a - b)[0] ?? -1;
}

function isInventoryPageTitle(title: string) {
  return /(?:pre-owned|used|new)?\s*(?:cars|vehicles|inventory)\s+for\s+sale|view\s+\d+\s+matches/i.test(title);
}

const VEHICLE_BLOCK_RADIUS = 5000;
const VEHICLE_HEADING = /^## \[[^\]]+\]\([^)]+\)/gm;
const ANOTHER_VIN_LINE = /\bVIN\s*:?\s*[A-HJ-NPR-Z0-9]{17}\b/gi;

// Rock 6 (I-07): a Dealer Inspire inventory page lists vehicles back to back. The old
// fixed 5000-character window after the VIN ran straight into the NEXT vehicle's block,
// so a matched vehicle with no price on the page inherited its neighbor's price.
// The window now stops at the next vehicle heading or the next vehicle's VIN line, and
// starts at the matched vehicle's own heading, so every field comes from one block.
export function vehicleBlockBounds(content: string, vinIndex: number) {
  const windowStart = Math.max(0, vinIndex - VEHICLE_BLOCK_RADIUS);
  const windowEnd = Math.min(content.length, vinIndex + VEHICLE_BLOCK_RADIUS);
  let start = windowStart;
  for (const match of content.slice(windowStart, vinIndex).matchAll(VEHICLE_HEADING)) {
    start = windowStart + (match.index ?? 0);
  }
  let end = windowEnd;
  const tail = content.slice(vinIndex + 17, windowEnd);
  for (const pattern of [VEHICLE_HEADING, ANOTHER_VIN_LINE]) {
    const next = tail.search(pattern);
    if (next >= 0) end = Math.min(end, vinIndex + 17 + next);
  }
  return { start, end };
}

export function parseDealerInspireMarkdown(markdown: string, sourceUrl: URL): ExtractedVehicle | null {
  if (isReaderChallengeMarkdown(markdown)) return null;
  const vin = vinFromUrl(sourceUrl);
  if (!vin) return null;
  const content = markdownContent(markdown);
  const vinIndex = vehicleEvidenceIndex(content, vin);
  if (vinIndex < 0) return null;
  const bounds = vehicleBlockBounds(content, vinIndex);
  const before = content.slice(bounds.start, vinIndex);
  const after = content.slice(vinIndex, bounds.end);
  const linkedTitle = (before.match(/## \[([^\]]+)\]\([^)]+\)\s*$/m) ?? Array.from(before.matchAll(/## \[([^\]]+)\]\([^)]+\)/g)).at(-1))?.[1];
  const plainHeadingTitle = Array.from(before.matchAll(/^##\s+(?!Visit our Store|Vehicle Information|Highlighted Features|Dealer Comments|Eligible Benefits|Package & Accessories|All Features)([^\n#][^\n]+)$/gim)).at(-1)?.[1];
  const title = decodeEntities(
    linkedTitle
    ?? plainHeadingTitle
    ?? markdown.match(/^Title:\s*(?!Just a moment|Attention Required)([^\n|]+)/im)?.[1]
    ?? ""
  );
  if (!title || isInventoryPageTitle(title)) return null;
  const stockNumber = markdownField(after, "Stock");
  const mileage = markdownField(before, "Mileage") || markdownField(after, "Mileage");
  const exteriorColor = markdownField(before, "Exterior") || markdownField(after, "Exterior");
  const interiorColor = markdownField(before, "Interior") || markdownField(after, "Interior");
  const dealershipName = markdownField(before, "Location") || markdownField(after, "Location") || decodeEntities(markdown.match(/^Title:\s*([^\n|]+)/m)?.[1] ?? "");
  const price = normalizeListedPrice(after.match(/(?:Cash|Total Price|Total SRP|Price excl\. tax, gov\. fees)\**\s*:?\s*\$?([\d,]+)/i)?.[1] || after.match(/(?:Sale Price|Your Price|MSRP \+ DPH|MSRP)\**\s*:?\s*\$?([\d,]+)/i)?.[1]);
  const markdownImages = Array.from(`${before}\n${after}`.matchAll(/!\[[^\]]*\]\((https?:\/\/[^)]+)\)/gi))
    .flatMap((match) => resolveImage(match[1], sourceUrl))
    .filter(usableImageUrl);
  const imageUrls = Array.from(new Set(markdownImages)).slice(0, 24);
  const year = title.match(/\b(20\d{2}|19\d{2})\b/)?.[1] || "";
  const titleParts = title.replace(/^New\s+|^Used\s+/i, "").split(/\s+/).filter(Boolean);
  const yearIndex = titleParts.findIndex((part) => part === year);
  const make = yearIndex >= 0 ? titleParts[yearIndex + 1] ?? "" : "";
  const model = yearIndex >= 0 ? [titleParts[yearIndex + 2], titleParts[yearIndex + 3]?.match(/^\d/) ? titleParts[yearIndex + 3] : ""].filter(Boolean).join(" ") : "";
  const trim = yearIndex >= 0 ? titleParts.slice(yearIndex + 2 + model.split(/\s+/).filter(Boolean).length).join(" ") : "";
  if (!title && !vin) return null;
  return {
    sourceUrl: sourceUrl.href,
    sourceHost: sourceUrl.hostname,
    title: title || "Imported vehicle",
    vin,
    stockNumber,
    year,
    make,
    model,
    trim,
    price,
    currency: "USD",
    description: "",
    imageUrls,
    facts: Object.fromEntries(Object.entries({
      dealershipName,
      mileage,
      exteriorColor,
      interiorColor,
      scrapeSource: "Dealer Inspire inventory listing",
    }).filter(([, value]) => value)),
  };
}

async function extractFromDealerInspireListing(sourceUrl: URL, deadline: { expiresAt: number }): Promise<ExtractedVehicle | null> {
  let attempts = 0;
  for (const inventoryUrl of fallbackVehicleSurfaces(sourceUrl)) {
    for (const readerUrl of readerUrls(inventoryUrl)) {
      if (attempts >= MAX_READER_ATTEMPTS) return null;
      attempts += 1;
      const timeout = timeoutFor(deadline, READER_FETCH_MS);
      try {
        const response = await fetch(readerUrl, {
          headers: {
            Accept: "text/plain,text/markdown,*/*",
            "X-Timeout": "5",
          },
          signal: timeout.signal,
        });
        if (!response.ok) continue;
        const markdown = await response.text();
        const extracted = parseDealerInspireMarkdown(markdown, sourceUrl);
        if (extracted) return extracted;
      } catch {
        // Try the next reader and public inventory surface.
      } finally {
        timeout.cleanup();
      }
    }
  }
  return null;
}

async function fetchViaBrightData(
  url: URL,
  deadline: { expiresAt: number },
  env: LotSocialEnvironment,
  context?: ExtractionContext,
): Promise<{ html: string; finalUrl: URL } | null> {
  const apiKey = env?.BRIGHTDATA_API_KEY;
  const zone = env?.BRIGHTDATA_ZONE;
  const envPresent = Boolean(apiKey);
  const zonePresent = Boolean(zone);
  const startedAt = Date.now();
  function logBranch(branch: string, extra: Record<string, unknown> = {}) {
    // Redacted: never logs apiKey/zone values, only presence booleans.
    console.warn("LotSocial Bright Data branch", {
      url: url.href,
      envPresent,
      zonePresent,
      elapsedMs: Date.now() - startedAt,
      branch,
      ...extra,
    });
  }
  if (!apiKey || !zone) {
    logBranch("skipped_no_credentials");
    return null;
  }
  if (!context?.associateEmail) throw new Error("Bright Data spend control requires an authenticated associate.");
  const budget = await reserveBrightDataBudget(env, context.associateEmail);
  if (!budget.allowed) {
    context.trace.budgetSkipped = true;
    context.trace.notice = "Paid extraction was skipped because the daily Bright Data budget was reached; LotSocial tried the free inventory path instead.";
    logBranch("skipped_budget", {
      associateCount: budget.associate.count,
      associateCap: budget.associate.cap,
      globalCount: budget.global?.count,
      globalCap: budget.global?.cap,
    });
    return null;
  }
  context.trace.brightDataUsed = true;
  const timeout = timeoutFor(deadline, BRIGHTDATA_FETCH_MS);
  try {
    const response = await fetch("https://api.brightdata.com/request", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ zone, url: url.href, format: "raw" }),
      signal: timeout.signal,
    });
    if (!response.ok) {
      logBranch("non_2xx", { status: response.status });
      return null;
    }
    const html = await response.text();
    if (!html || html.length > 3_000_000) {
      logBranch("success_unparseable", { length: html?.length ?? 0 });
      return null;
    }
    logBranch("success_parsed", { length: html.length });
    context.trace.fallback = "bright_data";
    return { html, finalUrl: url };
  } catch (caught) {
    const isAbort = caught instanceof Error && caught.name === "AbortError";
    logBranch(isAbort ? "timeout_abort" : "fetch_error", { message: caught instanceof Error ? caught.message : "unknown" });
    return null;
  } finally {
    timeout.cleanup();
  }
}

export async function extractVehicleFromVdp(
  value: string,
  env: LotSocialEnvironment,
  context?: ExtractionContext,
): Promise<ExtractedVehicle> {
  const requestedUrl = validatePublicUrl(value);
  const deadline = createDeadline();

  async function viaListingOrThrow(reason: string): Promise<{ html: string; finalUrl: URL }> {
    const viaBrightData = await fetchViaBrightData(requestedUrl, deadline, env, context);
    if (viaBrightData) return viaBrightData;
    const listingVehicle = await extractFromDealerInspireListing(requestedUrl, deadline);
    if (listingVehicle) {
      if (context) context.trace.fallback = "listing_guess";
      throw new ResolvedVehicle(listingVehicle);
    }
    throw new Error(`LotSocial could not scrape that VDP yet. ${reason} and no matching public inventory listing was found.`);
  }

  let resolved: { html: string; finalUrl: URL };
  try {
    const timeout = timeoutFor(deadline, DIRECT_FETCH_MS);
    let response: Response;
    try {
      response = await fetch(requestedUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 LotSocial/1.0",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
          "Cache-Control": "no-cache",
          Pragma: "no-cache",
          Referer: requestedUrl.origin,
        },
        redirect: "follow",
        signal: timeout.signal,
      });
    } catch (caught) {
      if (context && caught instanceof Error && caught.name === "AbortError") context.trace.networkTimedOut = true;
      resolved = await viaListingOrThrow("This store blocks the direct page");
      return await parseVehicleHtml(resolved.html, resolved.finalUrl);
    } finally {
      timeout.cleanup();
    }
    if (!response.ok) {
      console.warn("LotSocial VDP direct fetch failed", {
        url: requestedUrl.href,
        status: response.status,
        statusText: response.statusText,
        cfRay: response.headers.get("cf-ray") ?? "",
        cfMitigated: response.headers.get("cf-mitigated") ?? "",
        server: response.headers.get("server") ?? "",
        contentType: response.headers.get("content-type") ?? "",
      });
      resolved = await viaListingOrThrow("This store blocks the direct page");
      return await parseVehicleHtml(resolved.html, resolved.finalUrl);
    }
    const finalUrl = validatePublicUrl(response.url);
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("text/html") && !contentType.includes("application/xhtml")) throw new Error("That URL is not a vehicle detail page.");
    const declaredLength = Number(response.headers.get("content-length") ?? "0");
    if (declaredLength > 3_000_000) throw new Error("That VDP is too large to import safely.");
    const html = await response.text();
    if (html.length > 3_000_000) throw new Error("That VDP is too large to import safely.");
    if (isCloudflareChallenge(html, response.headers)) {
      resolved = await viaListingOrThrow("This store returned a Cloudflare challenge");
      return await parseVehicleHtml(resolved.html, resolved.finalUrl);
    }
    resolved = { html, finalUrl };
  } catch (caught) {
    if (caught instanceof ResolvedVehicle) return caught.vehicle;
    throw caught;
  }
  return await parseVehicleHtml(resolved.html, resolved.finalUrl);
}

class ResolvedVehicle extends Error {
  vehicle: ExtractedVehicle;
  constructor(vehicle: ExtractedVehicle) {
    super("resolved-via-listing-guess");
    this.vehicle = vehicle;
  }
}

export async function parseVehicleHtml(html: string, finalUrl: URL): Promise<ExtractedVehicle> {
  const nodes: Record<string, unknown>[] = [];
  for (const match of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { nodes.push(...flattenJsonLd(JSON.parse(match[1].trim()))); } catch { /* malformed third-party JSON-LD is ignored */ }
  }
  const vehicleNode = nodes.find((node) => typesOf(node).some((type) => ["vehicle", "car", "product", "individualproduct"].includes(type))) ?? {};
  const name = textValue(vehicleNode.name) || decodeEntities(meta(html, "og:title")) || decodeEntities(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "Imported vehicle");
  const visibleText = decodeEntities(html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " "));
  const offerValues = Array.isArray(vehicleNode.offers) ? vehicleNode.offers : [vehicleNode.offers];
  const offers = (offerValues.find((offer) => offer && typeof offer === "object") ?? {}) as Record<string, unknown>;
  const priceSpecification = (offers.priceSpecification && typeof offers.priceSpecification === "object" ? offers.priceSpecification : {}) as Record<string, unknown>;
  const brand = textValue(vehicleNode.brand) || textValue(vehicleNode.manufacturer);
  const imageTags = Array.from(html.matchAll(/<img\b[^>]*>/gi)).map((match) => match[0]);
  const galleryTags = imageTags.filter((tag) => /(?:alt|class|id)=["'][^"']*(?:slide|vehicle|inventory|gallery|carousel|swiper)/i.test(tag));
  const images = [
    ...resolveImage(vehicleNode.image, finalUrl),
    ...resolveImage(meta(html, "og:image"), finalUrl),
    ...galleryTags.flatMap((tag) => imageUrlsFromTag(tag, finalUrl)),
    ...imageTags.flatMap((tag) => imageUrlsFromTag(tag, finalUrl)),
  ].filter(usableImageUrl);
  const uniqueImages = Array.from(new Set(images)).slice(0, 24);
  const vin = textValue(vehicleNode.vehicleIdentificationNumber) || textValue(vehicleNode.vin) || visibleText.match(/\b[A-HJ-NPR-Z0-9]{17}\b/i)?.[0]?.toUpperCase() || "";
  const year = normalizeVehicleYear(textValue(vehicleNode.vehicleModelDate) || name.match(/\b(20\d{2}|19\d{2})\b/)?.[1] || "");
  const labeledPrice = visibleText.match(/(?:Total Price|Dealer Price|Sale Price|Selling Price|Internet Price|Today's Price|Our Price|MSRP)\s*[:\-]?\s*\$\s*([\d,]+(?:\.\d{1,2})?)/i)?.[1];
  const price = [
    offers.price,
    offers.lowPrice,
    priceSpecification.price,
    meta(html, "product:price:amount"),
    attributeValue(html, "itemprop", "price", "content"),
    labeledPrice,
  ].map(normalizeListedPrice).find(Boolean) || "";
  const description = decodeEntities(textValue(vehicleNode.description) || meta(html, "description")).slice(0, 3000);
  const organizationNode = nodes.find((node) => typesOf(node).includes("organization") && textValue(node.name));
  const dealershipName = textValue(offers.seller) || textValue(vehicleNode.seller) || textValue(vehicleNode.offeredBy)
    || decodeEntities(meta(html, "og:site_name")) || textValue(organizationNode?.name);
  const facts = {
    dealershipName,
    exteriorColor: textValue(vehicleNode.color),
    interiorColor: textValue(vehicleNode.vehicleInteriorColor),
    transmission: textValue(vehicleNode.vehicleTransmission),
    fuelType: textValue(vehicleNode.fuelType),
    drivetrain: textValue(vehicleNode.driveWheelConfiguration),
    bodyStyle: textValue(vehicleNode.bodyType),
  };
  const extracted: ExtractedVehicle = {
    sourceUrl: finalUrl.href,
    sourceHost: finalUrl.hostname,
    title: name.slice(0, 300),
    vin,
    stockNumber: textValue(vehicleNode.sku) || visibleText.match(/Stock\s*(?:#|Number)?\s*[:#]?\s*([A-Z0-9-]+)/i)?.[1] || "",
    year,
    make: brand,
    model: textValue(vehicleNode.model),
    trim: textValue(vehicleNode.vehicleConfiguration) || textValue(vehicleNode.trim),
    price,
    currency: textValue(offers.priceCurrency) || "USD",
    description,
    imageUrls: uniqueImages,
    facts: Object.fromEntries(Object.entries(facts).filter(([, item]) => item)),
  };
  if (isInventoryPageTitle(extracted.title)) {
    throw new Error("LotSocial landed on an inventory listing page, not a single vehicle page. Open the exact VDP for the vehicle and paste that URL.");
  }
  const hasVehicleEvidence = Boolean(extracted.vin) || Boolean(extracted.year && (extracted.make || extracted.model));
  if (!hasVehicleEvidence) {
    throw new Error("LotSocial could not confirm a specific vehicle on that page. Nothing was saved.");
  }
  return extracted;
}

export async function saveImportedVehicle(associateEmail: string, vehicle: ExtractedVehicle, env: LotSocialEnvironment) {
  await ensureVdpSchema(env);
  const db = database(env, "inventory");
  const sourceUrl = normalizeSourceUrl(vehicle.sourceUrl);
  const sourceHost = new URL(sourceUrl).hostname;
  const variants = sourceUrlVariants(vehicle.sourceUrl);
  const placeholders = variants.map(() => "?").join(", ");
  const existing = await db.prepare(`SELECT id, associate_email, source_url FROM imported_vehicles WHERE LOWER(associate_email) = LOWER(?) AND source_url IN (${placeholders}) ORDER BY CASE WHEN source_url = ? THEN 0 ELSE 1 END, updated_at DESC LIMIT 1`)
    .bind(associateEmail, ...variants, sourceUrl)
    .first<{ id: string; associate_email: string; source_url: string }>();
  const id = existing?.id ?? crypto.randomUUID();
  const storedAssociateEmail = existing?.associate_email ?? associateEmail;
  const certifiedAt = new Date().toISOString();
  if (existing && existing.source_url !== sourceUrl) {
    await db.prepare("UPDATE imported_vehicles SET source_url = ?, source_host = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND LOWER(associate_email) = LOWER(?)")
      .bind(sourceUrl, sourceHost, existing.id, associateEmail)
      .run();
  }
  await db.prepare(`INSERT INTO imported_vehicles (
    id, associate_email, source_url, source_host, title, vin, stock_number, year, make,
    model, trim, price, currency, description, image_urls, facts, authorization_certified_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(associate_email, source_url) DO UPDATE SET title = excluded.title, vin = excluded.vin,
    stock_number = excluded.stock_number, year = excluded.year, make = excluded.make,
    model = excluded.model, trim = excluded.trim, price = excluded.price,
    currency = excluded.currency, description = excluded.description,
    image_urls = excluded.image_urls, facts = excluded.facts,
    authorization_certified_at = excluded.authorization_certified_at,
    updated_at = CURRENT_TIMESTAMP`)
    .bind(id, storedAssociateEmail, sourceUrl, sourceHost, vehicle.title, vehicle.vin,
      vehicle.stockNumber, vehicle.year, vehicle.make, vehicle.model, vehicle.trim,
      vehicle.price, vehicle.currency, vehicle.description, JSON.stringify(vehicle.imageUrls),
      JSON.stringify(vehicle.facts), certifiedAt).run();
  return getImportedVehicle(id, associateEmail, env);
}

export async function getImportedVehicle(id: string, associateEmail: string, env: LotSocialEnvironment) {
  await ensureVdpSchema(env);
  return database(env, "inventory").prepare("SELECT * FROM imported_vehicles WHERE id = ? AND LOWER(associate_email) = LOWER(?) LIMIT 1").bind(id, associateEmail).first<ImportedVehicleRecord>();
}

export async function getImportedVehicleBySourceUrl(associateEmail: string, sourceUrl: string, env: LotSocialEnvironment) {
  await ensureVdpSchema(env);
  const variants = sourceUrlVariants(sourceUrl);
  const placeholders = variants.map(() => "?").join(", ");
  return database(env, "inventory").prepare(`SELECT * FROM imported_vehicles WHERE LOWER(associate_email) = LOWER(?) AND source_url IN (${placeholders}) ORDER BY updated_at DESC LIMIT 1`)
    .bind(associateEmail, ...variants)
    .first<ImportedVehicleRecord>();
}

export async function listImportedVehicles(associateEmail: string, env: LotSocialEnvironment) {
  await ensureVdpSchema(env);
  const result = await database(env, "inventory").prepare("SELECT * FROM imported_vehicles WHERE LOWER(associate_email) = LOWER(?) ORDER BY imported_at DESC LIMIT 100").bind(associateEmail).all<ImportedVehicleRecord>();
  return result.results;
}

export function serializeVehicle(record: ImportedVehicleRecord) {
  return {
    id: record.id,
    sourceUrl: record.source_url,
    sourceHost: record.source_host,
    title: record.title,
    vin: record.vin,
    stockNumber: record.stock_number,
    year: normalizeVehicleYear(record.year),
    make: record.make,
    model: record.model,
    trim: record.trim,
    price: record.price,
    currency: record.currency,
    description: record.description,
    imageUrls: JSON.parse(record.image_urls || "[]") as string[],
    facts: JSON.parse(record.facts || "{}") as Record<string, string>,
    sourceType: record.source_type,
    certifiedAt: record.authorization_certified_at,
    importedAt: record.imported_at,
    updatedAt: record.updated_at,
  };
}
