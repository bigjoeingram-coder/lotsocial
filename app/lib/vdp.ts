import { env } from "cloudflare:workers";

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

let schemaReady: Promise<void> | null = null;
const IMPORT_DEADLINE_MS = 36_000;
const DIRECT_FETCH_MS = 8_000;
const READER_FETCH_MS = 14_000;
const MAX_READER_ATTEMPTS = 6;

function database() {
  if (!env.DB) throw new Error("The inventory database is unavailable.");
  return env.DB;
}

async function ensureVdpSchema() {
  if (!schemaReady) {
    const db = database();
    schemaReady = db.batch([
      db.prepare(`CREATE TABLE IF NOT EXISTS imported_vehicles (
        id TEXT PRIMARY KEY,
        associate_email TEXT NOT NULL,
        source_url TEXT NOT NULL,
        source_host TEXT NOT NULL,
        title TEXT NOT NULL,
        vin TEXT NOT NULL DEFAULT '',
        stock_number TEXT NOT NULL DEFAULT '',
        year TEXT NOT NULL DEFAULT '',
        make TEXT NOT NULL DEFAULT '',
        model TEXT NOT NULL DEFAULT '',
        trim TEXT NOT NULL DEFAULT '',
        price TEXT NOT NULL DEFAULT '',
        currency TEXT NOT NULL DEFAULT 'USD',
        description TEXT NOT NULL DEFAULT '',
        image_urls TEXT NOT NULL DEFAULT '[]',
        facts TEXT NOT NULL DEFAULT '{}',
        source_type TEXT NOT NULL DEFAULT 'vdp_one_time',
        authorization_certified_at TEXT NOT NULL,
        imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(associate_email, source_url)
      )`),
      db.prepare("CREATE INDEX IF NOT EXISTS imported_vehicles_associate_idx ON imported_vehicles(associate_email, imported_at DESC)"),
    ]).then(() => undefined);
  }
  return schemaReady;
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

function sourceUrlVariants(value: string) {
  const url = validatePublicUrl(value);
  const variants = new Set([url.href]);
  const toggleTrailingSlash = new URL(url.href);
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

function normalizeListedPrice(value: unknown) {
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

function vinFromUrl(url: URL) {
  return url.pathname.match(/\b[A-HJ-NPR-Z0-9]{17}\b/i)?.[0]?.toUpperCase() ?? "";
}

function vehicleSlugParts(url: URL) {
  const segment = url.pathname.split("/").filter(Boolean).find((part) => part.startsWith("new-") || part.startsWith("used-")) ?? "";
  return segment.split("-").filter(Boolean);
}

function candidateInventoryPaths(url: URL) {
  const vin = vinFromUrl(url);
  const parts = vehicleSlugParts(url);
  const makeIndex = parts.findIndex((part) => ["lexus", "maserati", "ford", "lincoln", "toyota", "honda", "chevrolet", "gmc", "buick", "cadillac", "bmw", "mercedes", "mercedesbenz", "audi", "porsche", "hyundai", "kia", "nissan", "mazda", "subaru", "volvo", "land", "range"].includes(part));
  const model = makeIndex >= 0 ? parts[makeIndex + 1] : "";
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

function parseDealerInspireMarkdown(markdown: string, sourceUrl: URL): ExtractedVehicle | null {
  if (isReaderChallengeMarkdown(markdown)) return null;
  const vin = vinFromUrl(sourceUrl);
  if (!vin) return null;
  const content = markdownContent(markdown);
  const vinIndex = vehicleEvidenceIndex(content, vin);
  if (vinIndex < 0) return null;
  const before = content.slice(Math.max(0, vinIndex - 5000), vinIndex);
  const after = content.slice(vinIndex, Math.min(content.length, vinIndex + 5000));
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

export async function extractVehicleFromVdp(value: string): Promise<ExtractedVehicle> {
  const requestedUrl = validatePublicUrl(value);
  const deadline = createDeadline();
  const timeout = timeoutFor(deadline, DIRECT_FETCH_MS);
  let response: Response | null = null;
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
  } catch {
    const listingVehicle = await extractFromDealerInspireListing(requestedUrl, deadline);
    if (listingVehicle) return listingVehicle;
    throw new Error(`LotSocial could not scrape that VDP yet. This store blocks the direct page and no matching public inventory listing was found.`);
  } finally { timeout.cleanup(); }
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
    const listingVehicle = await extractFromDealerInspireListing(requestedUrl, deadline);
    if (listingVehicle) return listingVehicle;
    throw new Error(`LotSocial could not scrape that VDP yet. This store blocks the direct page and no matching public inventory listing was found.`);
  }
  const finalUrl = validatePublicUrl(response.url);
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/html") && !contentType.includes("application/xhtml")) throw new Error("That URL is not a vehicle detail page.");
  const declaredLength = Number(response.headers.get("content-length") ?? "0");
  if (declaredLength > 3_000_000) throw new Error("That VDP is too large to import safely.");
  const html = await response.text();
  if (html.length > 3_000_000) throw new Error("That VDP is too large to import safely.");
  if (isCloudflareChallenge(html, response.headers)) {
    const listingVehicle = await extractFromDealerInspireListing(requestedUrl, deadline);
    if (listingVehicle) return listingVehicle;
    throw new Error("LotSocial could not scrape that VDP yet. This store returned a Cloudflare challenge and no matching public inventory listing was found.");
  }

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
  const year = textValue(vehicleNode.vehicleModelDate) || name.match(/\b(20\d{2}|19\d{2})\b/)?.[1] || "";
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
  if (!extracted.vin && !extracted.title) throw new Error("LotSocial could not identify a vehicle on that page.");
  return extracted;
}

export async function saveImportedVehicle(associateEmail: string, vehicle: ExtractedVehicle) {
  await ensureVdpSchema();
  const existing = await database().prepare("SELECT id FROM imported_vehicles WHERE LOWER(associate_email) = LOWER(?) AND source_url = ? LIMIT 1").bind(associateEmail, vehicle.sourceUrl).first<{ id: string }>();
  const id = existing?.id ?? crypto.randomUUID();
  const certifiedAt = new Date().toISOString();
  await database().prepare(`INSERT INTO imported_vehicles (
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
    .bind(id, associateEmail, vehicle.sourceUrl, vehicle.sourceHost, vehicle.title, vehicle.vin,
      vehicle.stockNumber, vehicle.year, vehicle.make, vehicle.model, vehicle.trim,
      vehicle.price, vehicle.currency, vehicle.description, JSON.stringify(vehicle.imageUrls),
      JSON.stringify(vehicle.facts), certifiedAt).run();
  return getImportedVehicle(id, associateEmail);
}

export async function getImportedVehicle(id: string, associateEmail: string) {
  await ensureVdpSchema();
  return database().prepare("SELECT * FROM imported_vehicles WHERE id = ? AND LOWER(associate_email) = LOWER(?) LIMIT 1").bind(id, associateEmail).first<ImportedVehicleRecord>();
}

export async function getImportedVehicleBySourceUrl(associateEmail: string, sourceUrl: string) {
  await ensureVdpSchema();
  const variants = sourceUrlVariants(sourceUrl);
  const placeholders = variants.map(() => "?").join(", ");
  return database().prepare(`SELECT * FROM imported_vehicles WHERE LOWER(associate_email) = LOWER(?) AND source_url IN (${placeholders}) ORDER BY updated_at DESC LIMIT 1`)
    .bind(associateEmail, ...variants)
    .first<ImportedVehicleRecord>();
}

export async function listImportedVehicles(associateEmail: string) {
  await ensureVdpSchema();
  const result = await database().prepare("SELECT * FROM imported_vehicles WHERE LOWER(associate_email) = LOWER(?) ORDER BY imported_at DESC LIMIT 100").bind(associateEmail).all<ImportedVehicleRecord>();
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
    year: record.year,
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
