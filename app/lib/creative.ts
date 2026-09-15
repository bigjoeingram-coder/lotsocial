import { database, ensureLotSocialSchema } from "./schema-bootstrap.ts";
import type { LotSocialEnvironment } from "./schema-bootstrap.ts";
import { normalizeVehicleYear } from "./vdp.ts";
import type { ImportedVehicleRecord } from "./vdp.ts";
import { PRICING_DISCLAIMER_VERSION } from "./evidence.ts";

export type CreativeProjectRecord = {
  id: string;
  vehicle_id: string;
  associate_email: string;
  selected_images: string;
  style: string;
  duration_seconds: number;
  voiceover_script: string;
  social_caption: string;
  end_card_name: string;
  end_card_phone: string;
  end_card_email: string;
  end_card_cta: string;
  end_card_photo_url: string;
  disclaimer_version: string;
  status: string;
  created_at: string;
  updated_at: string;
};

export type GravyLevel = "none" | "light" | "extra";

export type CreativeRenderJobRecord = {
  id: string;
  project_id: string;
  associate_email: string;
  provider: string;
  provider_render_id: string;
  status: string;
  render_plan: string;
  output_url: string;
  storage_key: string;
  error_message: string;
  created_at: string;
  updated_at: string;
};

async function ensureCreativeSchema(env: LotSocialEnvironment) {
  return ensureLotSocialSchema(env);
}

function vehicleName(vehicle: ImportedVehicleRecord) {
  return cleanCopyLine([normalizeVehicleYear(vehicle.year), vehicle.make, vehicle.model, vehicle.trim].filter(Boolean).join(" ") || vehicle.title);
}

function displayPrice(value: string) {
  const amount = Number(value.replace(/[^\d.]/g, ""));
  return Number.isFinite(amount) ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(amount) : value;
}

function decodeHtmlEntities(value: string) {
  let decoded = value;
  for (let index = 0; index < 3; index += 1) {
    const next = decoded
      .replace(/&amp;/gi, "&")
      .replace(/&quot;/gi, '"')
      .replace(/&apos;|&#0*39;/gi, "'")
      .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => {
        const codePoint = Number.parseInt(hex, 16);
        return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : "";
      })
      .replace(/&#0*(\d+);/g, (_, decimal: string) => {
        const codePoint = Number.parseInt(decimal, 10);
        return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : "";
      })
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&nbsp;/gi, " ");
    if (next === decoded) break;
    decoded = next;
  }
  return decoded;
}

function cleanCopyLine(value: string) {
  return decodeHtmlEntities(value)
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanCopyBlock(value: string) {
  return decodeHtmlEntities(value)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function groundedHighlights(vehicle: ImportedVehicleRecord) {
  const facts = JSON.parse(vehicle.facts || "{}") as Record<string, string>;
  // ALLOWLIST: only these keys may ever reach public-facing copy.
  // Anything not listed here (internal fields such as scrapeSource, dealershipName,
  // or any future diagnostic key) is excluded by default rather than by exception.
  const labels: Record<string, string> = {
    exteriorColor: "Exterior",
    interiorColor: "Interior",
    transmission: "Transmission",
    fuelType: "Fuel",
    drivetrain: "Drivetrain",
    bodyStyle: "Body style",
  };
  return Object.entries(facts)
    .filter(([key, value]) => Object.prototype.hasOwnProperty.call(labels, key) && Boolean(value))
    .map(([key, value]) => `${labels[key]}: ${cleanCopyLine(value)}`)
    .filter((value) => !/&#\d+;|&[a-z]+;/i.test(value))
    .slice(0, 4);
}

function captionDescription(vehicle: ImportedVehicleRecord) {
  const description = cleanCopyLine(vehicle.description);
  if (!description) return "";
  const sentences = description.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [description];
  const summary = sentences.slice(0, 2).join(" ").trim();
  return summary.length > 320 ? `${summary.slice(0, 317).trimEnd()}...` : summary;
}

function hashtag(value: string, fallback: string) {
  return (value || fallback).replace(/[^a-zA-Z0-9]/g, "") || fallback;
}

function dealershipName(vehicle: ImportedVehicleRecord) {
  const facts = JSON.parse(vehicle.facts || "{}") as Record<string, string>;
  if (facts.dealershipName) return cleanCopyLine(facts.dealershipName);
  return vehicle.source_host.replace(/^www\./i, "").split(".")[0] || "Dealership";
}

function normalizeGravyLevel(value: GravyLevel | boolean): GravyLevel {
  if (value === true) return "light";
  return value === "light" || value === "extra" ? value : "none";
}

export function createCopy(vehicle: ImportedVehicleRecord, style: string, durationSeconds: number, endCardName: string, endCardCta: string, gravy: GravyLevel | boolean = "none") {
  const gravyLevel = normalizeGravyLevel(gravy);
  const hasGravy = gravyLevel !== "none";
  const extraGravy = gravyLevel === "extra";
  const name = vehicleName(vehicle);
  const highlights = groundedHighlights(vehicle);
  const description = captionDescription(vehicle);
  const priceLine = vehicle.price ? `It was listed at ${displayPrice(vehicle.price)} when this vehicle page was captured.` : "Contact me for current pricing and availability.";
  const detailLine = highlights.length
    ? hasGravy
      ? `And it comes dressed to impress — ${highlights.join(", ")}.`
      : `Highlights listed by the dealership include ${highlights.join(", ")}.`
    : "Open the original dealership listing for the complete equipment and feature details.";
  const flavoredOpenings: Record<Exclude<GravyLevel, "none">, Record<string, string[]>> = {
    // Gravy adds subjective sizzle only (opinion/puffery). It never adds facts,
    // specs, availability, or condition claims beyond what the VDP captured.
    light: {
      energetic: [`Take a closer look at this sharp ${name}.`, `This ${name} knows how to make an entrance.`, `Here is one eye-catching ${name}.`],
      walkaround: [`Let me walk you around one sharp ${name}.`, `Up close, this ${name} makes a real impression.`, `Take the full tour of this standout ${name}.`],
      premium: [`Meet one polished ${name}.`, `Refined, composed, confident — this ${name}.`, `An elevated look at a striking ${name}.`],
    },
    extra: {
      energetic: [`Stop the scroll — this ${name} is ready for its close-up.`, `This ${name} has zero interest in blending in.`, `Give this head-turning ${name} the spotlight.`],
      walkaround: [`Every angle of this ${name} deserves a closer look.`, `Let us give this seriously sharp ${name} the full walkaround.`, `This standout ${name} makes the camera work easy.`],
      premium: [`Some vehicles simply command attention. Meet the ${name}.`, `Polished, poised, and impossible to overlook — this ${name}.`, `Roll out the red carpet for this striking ${name}.`],
    },
  };
  const factualOpenings: Record<string, string[]> = {
    energetic: [`Take a look at this ${name}.`, `Here is this ${name} from the dealership listing.`, `Here is a quick look at this ${name}.`],
    walkaround: [`Let me show you this ${name}.`, `Here is a closer look at this ${name}.`, `Walk around this ${name} with me.`],
    premium: [`Meet the ${name}.`, `A refined look at this ${name}.`, `Presenting this ${name}.`],
  };
  const openings = hasGravy ? flavoredOpenings[gravyLevel as Exclude<GravyLevel, "none">] : factualOpenings;
  const options = openings[style] ?? openings.walkaround;
  const seed = Array.from(vehicle.vin || vehicle.id).reduce((sum, character) => sum + character.charCodeAt(0), 0);
  const opening = options[seed % options.length];
  const short = durationSeconds <= 15;
  const voiceoverScript = short
    ? `${opening} ${priceLine} ${endCardCta} with ${endCardName}.`
    : `${opening} ${detailLine} ${priceLine} Vehicle details can change, so confirm current information with the dealership. ${endCardCta} with ${endCardName}.`;
  const makeModelTag = hashtag(`${vehicle.make}${vehicle.model}`, "Vehicle");
  const salespersonTag = hashtag(endCardName, "Salesperson");
  const dealershipTag = hashtag(dealershipName(vehicle), "Dealership");
  const facts = JSON.parse(vehicle.facts || "{}") as Record<string, string>;
  const bodyHint = `${facts.bodyStyle ?? ""} ${vehicle.model}`.toLowerCase();
  const extraOpeners: Record<string, string[]> = {
    truck: [
      "Big truck presence, with a look made to own the frame.",
      "Bold stance, sharp details, and zero interest in blending in.",
      "This truck understands the assignment: make every angle count.",
    ],
    suv: [
      "Confident stance, clean lines, and camera-ready from every angle.",
      "Practical never has to mean predictable, and this look proves it.",
      "This SUV brings enough presence to fill the frame all by itself.",
    ],
    coupe: [
      "Every line is working overtime to steal the scene.",
      "Some cars pose for the camera without even trying.",
      "Low-slung style and serious presence, even standing still.",
    ],
    generic: [
      "The kind of vehicle that makes the walkaround worth filming.",
      "Sharp in photos. Sharper in person.",
      "This one brings a little main-character energy to the lot.",
    ],
  };
  const vibeKey = /truck|pickup|f-150|f-250|f-350|silverado|sierra|ram |tundra|tacoma|raptor|maverick|ranger|colorado|frontier|titan/.test(bodyHint)
    ? "truck"
    : /suv|crossover|4runner|explorer|expedition|tahoe|suburban|grecale|levante|highlander|rav4|pilot|palisade|telluride|bronco|wrangler|grand cherokee|rx |ux |nx |gx |lx /.test(bodyHint)
      ? "suv"
      : /coupe|convertible|roadster|mustang|corvette|gt500|challenger|charger|supra|brz|gr86|miata|911|cayman/.test(bodyHint)
        ? "coupe"
        : "generic";
  const vibeSeed = Array.from(vehicle.vin || vehicle.id).reduce((sum, character) => sum + character.charCodeAt(0), 0);
  const vibePool = extraOpeners[vibeKey];
  const vibeOpener = vibePool[vibeSeed % vibePool.length];
  const gravyBridge = `This ${[normalizeVehicleYear(vehicle.year), vehicle.make, vehicle.model].filter(Boolean).join(" ")} brings a sharp look and confident presence.`;
  const captionHeadline = hasGravy ? [cleanCopyLine(facts.exteriorColor ?? ""), name].filter(Boolean).join(" ") : name;
  const gravyIntro = gravyLevel === "light" ? `${gravyBridge}\n\n` : extraGravy ? `${vibeOpener} ${gravyBridge} Every angle brings another reason to keep watching.\n\n` : "";
  const gravyClose = gravyLevel === "light" ? `Come see why this one stands out in person.\n\n` : extraGravy ? `Give it the spotlight, take the full walkaround, and see how it looks in person.\n\n` : "";
  const capturedAt = new Date(vehicle.imported_at.replace(" ", "T") + (/Z$|[+-]\d\d:\d\d$/.test(vehicle.imported_at) ? "" : "Z"));
  const capturedAtText = Number.isFinite(capturedAt.getTime())
    ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC", timeZoneName: "short" }).format(capturedAt)
    : "the recorded capture time";
  const pricingDisclaimer = `Pricing and availability as shown on the dealer's website on ${capturedAtText}; subject to change. Confirm current price with the dealership.`;
  const socialCaption = `${captionHeadline}\n\n${gravyIntro}${description ? `${description}\n\n` : ""}${highlights.length ? `${highlights.join(" · ")}\n\n` : ""}${vehicle.price ? `Total price listed on ${cleanCopyLine(vehicle.source_host)}: ${displayPrice(vehicle.price)}.\n\n` : ""}${gravyClose}${endCardCta}.\n\n${pricingDisclaimer}\n\nConfirm equipment and eligibility with the dealership. This ad expires 7 days after posting or when the vehicle sells, whichever comes first.\n\n#${makeModelTag} #${salespersonTag} #${dealershipTag} #lotsocial`;
  return { voiceoverScript: cleanCopyBlock(voiceoverScript), socialCaption: cleanCopyBlock(socialCaption) };
}

export async function saveCreativeProject(input: {
  vehicle: ImportedVehicleRecord;
  associateEmail: string;
  selectedImages: string[];
  style: string;
  durationSeconds: number;
  endCardName: string;
  endCardPhone: string;
  endCardEmail: string;
  endCardCta: string;
  endCardPhotoUrl: string;
  gravyLevel?: GravyLevel;
  flavor?: boolean;
  env: LotSocialEnvironment;
}) {
  await ensureCreativeSchema(input.env);
  const db = database(input.env, "creative");
  const id = crypto.randomUUID();
  const copy = createCopy(input.vehicle, input.style, input.durationSeconds, input.endCardName, input.endCardCta, input.gravyLevel ?? (input.flavor === true ? "light" : "none"));
  await db.prepare(`INSERT INTO creative_projects (
    id, vehicle_id, associate_email, selected_images, style, duration_seconds,
    voiceover_script, social_caption, end_card_name, end_card_phone, end_card_email,
    end_card_cta, end_card_photo_url, disclaimer_version, status
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'storyboard_ready')`)
    .bind(id, input.vehicle.id, input.associateEmail, JSON.stringify(input.selectedImages),
      input.style, input.durationSeconds, copy.voiceoverScript, copy.socialCaption,
      input.endCardName, input.endCardPhone, input.endCardEmail, input.endCardCta,
      input.endCardPhotoUrl, PRICING_DISCLAIMER_VERSION).run();
  return db.prepare("SELECT * FROM creative_projects WHERE id = ? LIMIT 1").bind(id).first<CreativeProjectRecord>();
}

export function serializeCreativeProject(record: CreativeProjectRecord) {
  return {
    id: record.id,
    vehicleId: record.vehicle_id,
    selectedImages: JSON.parse(record.selected_images || "[]") as string[],
    style: record.style,
    durationSeconds: record.duration_seconds,
    voiceoverScript: record.voiceover_script,
    socialCaption: record.social_caption,
    endCardName: record.end_card_name,
    endCardPhone: record.end_card_phone,
    endCardEmail: record.end_card_email,
    endCardCta: record.end_card_cta,
    endCardPhotoUrl: record.end_card_photo_url,
    disclaimerVersion: record.disclaimer_version,
    status: record.status,
    createdAt: record.created_at,
  };
}

export async function getCreativeProject(id: string, associateEmail: string, env: LotSocialEnvironment) {
  await ensureCreativeSchema(env);
  return database(env, "creative").prepare("SELECT * FROM creative_projects WHERE id = ? AND associate_email = ? LIMIT 1")
    .bind(id, associateEmail).first<CreativeProjectRecord>();
}

export async function createRenderJob(input: {
  projectId: string;
  associateEmail: string;
  renderPlan: unknown;
  providerRenderId?: string;
  status: string;
  errorMessage?: string;
  env: LotSocialEnvironment;
}) {
  await ensureCreativeSchema(input.env);
  const db = database(input.env, "creative");
  const id = crypto.randomUUID();
  await db.prepare(`INSERT INTO creative_render_jobs (
    id, project_id, associate_email, provider, provider_render_id, status,
    render_plan, error_message
  ) VALUES (?, ?, ?, 'shotstack', ?, ?, ?, ?)`)
    .bind(id, input.projectId, input.associateEmail, input.providerRenderId ?? "",
      input.status, JSON.stringify(input.renderPlan), input.errorMessage ?? "").run();
  return db.prepare("SELECT * FROM creative_render_jobs WHERE id = ? LIMIT 1")
    .bind(id).first<CreativeRenderJobRecord>();
}

export async function getLatestRenderJob(projectId: string, associateEmail: string, env: LotSocialEnvironment) {
  await ensureCreativeSchema(env);
  return database(env, "creative").prepare(`SELECT * FROM creative_render_jobs
    WHERE project_id = ? AND associate_email = ?
    ORDER BY created_at DESC LIMIT 1`)
    .bind(projectId, associateEmail).first<CreativeRenderJobRecord>();
}

export async function updateRenderJob(input: {
  id: string;
  associateEmail: string;
  status: string;
  outputUrl?: string;
  storageKey?: string;
  errorMessage?: string;
  env: LotSocialEnvironment;
}) {
  await ensureCreativeSchema(input.env);
  const db = database(input.env, "creative");
  await db.prepare(`UPDATE creative_render_jobs
    SET status = ?, output_url = ?, storage_key = ?, error_message = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND associate_email = ?`)
    .bind(input.status, input.outputUrl ?? "", input.storageKey ?? "", input.errorMessage ?? "", input.id, input.associateEmail).run();
  return db.prepare("SELECT * FROM creative_render_jobs WHERE id = ? AND associate_email = ? LIMIT 1")
    .bind(input.id, input.associateEmail).first<CreativeRenderJobRecord>();
}

export async function getRenderJob(id: string, associateEmail: string, env: LotSocialEnvironment) {
  await ensureCreativeSchema(env);
  return database(env, "creative").prepare("SELECT * FROM creative_render_jobs WHERE id = ? AND associate_email = ? LIMIT 1")
    .bind(id, associateEmail).first<CreativeRenderJobRecord>();
}

export function serializeRenderJob(record: CreativeRenderJobRecord) {
  const plan = JSON.parse(record.render_plan || "{}") as { summary?: unknown };
  return {
    id: record.id,
    projectId: record.project_id,
    provider: record.provider,
    providerRenderId: record.provider_render_id,
    status: record.status,
    outputUrl: record.output_url,
    stored: Boolean(record.storage_key),
    errorMessage: record.error_message,
    summary: plan.summary ?? null,
    createdAt: record.created_at,
    updatedAt: record.updated_at,
  };
}
