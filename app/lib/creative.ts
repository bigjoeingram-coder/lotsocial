import { env } from "cloudflare:workers";
import { ImportedVehicleRecord } from "./vdp";

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
  status: string;
  created_at: string;
  updated_at: string;
};

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

let schemaReady: Promise<void> | null = null;

function database() {
  if (!env.DB) throw new Error("The creative database is unavailable.");
  return env.DB;
}

async function ensureCreativeSchema() {
  if (!schemaReady) {
    const db = database();
    schemaReady = db.batch([
      db.prepare(`CREATE TABLE IF NOT EXISTS creative_projects (
        id TEXT PRIMARY KEY,
        vehicle_id TEXT NOT NULL,
        associate_email TEXT NOT NULL,
        selected_images TEXT NOT NULL DEFAULT '[]',
        style TEXT NOT NULL,
        duration_seconds INTEGER NOT NULL DEFAULT 30,
        voiceover_script TEXT NOT NULL,
        social_caption TEXT NOT NULL,
        end_card_name TEXT NOT NULL,
        end_card_phone TEXT NOT NULL DEFAULT '',
        end_card_email TEXT NOT NULL DEFAULT '',
        end_card_cta TEXT NOT NULL DEFAULT 'Message me for details',
        status TEXT NOT NULL DEFAULT 'draft',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`),
      db.prepare("CREATE INDEX IF NOT EXISTS creative_projects_associate_idx ON creative_projects(associate_email, created_at DESC)"),
      db.prepare("CREATE INDEX IF NOT EXISTS creative_projects_vehicle_idx ON creative_projects(vehicle_id, created_at DESC)"),
      db.prepare(`CREATE TABLE IF NOT EXISTS creative_render_jobs (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        associate_email TEXT NOT NULL,
        provider TEXT NOT NULL DEFAULT 'shotstack',
        provider_render_id TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'prepared',
        render_plan TEXT NOT NULL,
        output_url TEXT NOT NULL DEFAULT '',
        storage_key TEXT NOT NULL DEFAULT '',
        error_message TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`),
      db.prepare("CREATE INDEX IF NOT EXISTS creative_render_jobs_project_idx ON creative_render_jobs(project_id, created_at DESC)"),
      db.prepare("CREATE INDEX IF NOT EXISTS creative_render_jobs_associate_idx ON creative_render_jobs(associate_email, created_at DESC)"),
    ]).then(() => undefined);
  }
  return schemaReady;
}

function vehicleName(vehicle: ImportedVehicleRecord) {
  return [vehicle.year, vehicle.make, vehicle.model, vehicle.trim].filter(Boolean).join(" ") || vehicle.title;
}

function displayPrice(value: string) {
  const amount = Number(value.replace(/[^\d.]/g, ""));
  return Number.isFinite(amount) ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(amount) : value;
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
    .map(([key, value]) => `${labels[key]}: ${value}`)
    .slice(0, 4);
}

function captionDescription(vehicle: ImportedVehicleRecord) {
  const description = vehicle.description.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
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
  if (facts.dealershipName) return facts.dealershipName;
  return vehicle.source_host.replace(/^www\./i, "").split(".")[0] || "Dealership";
}

function createCopy(vehicle: ImportedVehicleRecord, style: string, durationSeconds: number, endCardName: string, endCardCta: string, flavor = false) {
  const name = vehicleName(vehicle);
  const highlights = groundedHighlights(vehicle);
  const description = captionDescription(vehicle);
  const priceLine = vehicle.price ? `It was listed at ${displayPrice(vehicle.price)} when this vehicle page was captured.` : "Contact me for current pricing and availability.";
  const detailLine = highlights.length
    ? flavor
      ? `And it comes dressed to impress — ${highlights.join(", ")}.`
      : `Highlights listed by the dealership include ${highlights.join(", ")}.`
    : "Open the original dealership listing for the complete equipment and feature details.";
  const openings: Record<string, string[]> = flavor ? {
    // Flavor mode: subjective sizzle only (opinion/puffery). Never adds facts,
    // specs, availability, or condition claims beyond what the VDP captured.
    energetic: [`Stop the scroll — this ${name} is a serious head-turner.`, `This ${name} just hit the lot and it is not shy.`, `You are going to want a closer look at this ${name}.`],
    walkaround: [`Let me walk you around one sharp ${name}.`, `Up close, this ${name} makes a real impression.`, `Take the full tour of this standout ${name}.`],
    premium: [`Some vehicles simply command attention. Meet the ${name}.`, `Refined, composed, confident — this ${name}.`, `An elevated look at a truly striking ${name}.`],
  } : {
    energetic: [`Take a look at this ${name}.`, `Fresh on the lot: this ${name}.`, `Here is a quick look at this ${name}.`],
    walkaround: [`Let me show you this ${name}.`, `Here is a closer look at this ${name}.`, `Walk around this ${name} with me.`],
    premium: [`Meet the ${name}.`, `A refined look at this ${name}.`, `Presenting this ${name}.`],
  };
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
  const vibeOpeners: Record<string, string[]> = {
    truck: [
      "Big truck energy, factory-built to turn heads and back it up.",
      "Some trucks haul. This one makes a statement doing it.",
      "Work-ready, weekend-approved, and impossible to miss in a parking lot.",
      "This is what showing up looks like when the truck does the talking.",
      "Built for the job site, styled for everywhere else.",
    ],
    suv: [
      "All the presence, none of the compromise.",
      "Room for everyone, and an entrance everywhere it goes.",
      "The family hauler that never got the memo about being boring.",
      "Practical on paper. Anything but practical-looking in person.",
      "Everyday capability with a stance that stops the scroll.",
    ],
    coupe: [
      "Built to be looked at twice — and driven off once.",
      "Some cars get parked. This one gets photographed.",
      "The commute just became the best part of the day.",
      "Low, loud presence — even standing still.",
      "This is the one people ask about at every stoplight.",
    ],
    generic: [
      "The kind of vehicle that makes the walkaround worth filming.",
      "One look and you understand why it does not sit long.",
      "Sharp in photos. Sharper in person.",
      "The listing does not do it justice — but here it is anyway.",
      "This one earns the double-take.",
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
  const vibePool = vibeOpeners[vibeKey];
  const vibeOpener = vibePool[vibeSeed % vibePool.length];
  const flavorBridge = `This ${[vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(" ")} brings the look, the stance, and the hardware.`;
  const captionHeadline = flavor ? [facts.exteriorColor, name].filter(Boolean).join(" ") : name;
  const flavorIntro = flavor ? `${vibeOpener} ${flavorBridge}\n\n` : "";
  const flavorClose = flavor ? `Come see why this one stands out in person.\n\n` : "";
  const socialCaption = `${captionHeadline}\n\n${flavorIntro}${description ? `${description}\n\n` : ""}${highlights.length ? `${highlights.join(" · ")}\n\n` : ""}${vehicle.price ? `Total price listed on the VDP: ${displayPrice(vehicle.price)}.\n\n` : ""}${flavorClose}${endCardCta}. Confirm current price, availability, equipment, and eligibility with the dealership.\n\nThis ad expires 7 days after posting or when the vehicle sells, whichever comes first.\n\n#${makeModelTag} #${salespersonTag} #${dealershipTag} #lotsocial`;
  return { voiceoverScript, socialCaption };
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
  flavor?: boolean;
}) {
  await ensureCreativeSchema();
  const id = crypto.randomUUID();
  const copy = createCopy(input.vehicle, input.style, input.durationSeconds, input.endCardName, input.endCardCta, input.flavor === true);
  await database().prepare(`INSERT INTO creative_projects (
    id, vehicle_id, associate_email, selected_images, style, duration_seconds,
    voiceover_script, social_caption, end_card_name, end_card_phone, end_card_email,
    end_card_cta, status
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'storyboard_ready')`)
    .bind(id, input.vehicle.id, input.associateEmail, JSON.stringify(input.selectedImages),
      input.style, input.durationSeconds, copy.voiceoverScript, copy.socialCaption,
      input.endCardName, input.endCardPhone, input.endCardEmail, input.endCardCta).run();
  return database().prepare("SELECT * FROM creative_projects WHERE id = ? LIMIT 1").bind(id).first<CreativeProjectRecord>();
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
    status: record.status,
    createdAt: record.created_at,
  };
}

export async function getCreativeProject(id: string, associateEmail: string) {
  await ensureCreativeSchema();
  return database().prepare("SELECT * FROM creative_projects WHERE id = ? AND associate_email = ? LIMIT 1")
    .bind(id, associateEmail).first<CreativeProjectRecord>();
}

export async function createRenderJob(input: {
  projectId: string;
  associateEmail: string;
  renderPlan: unknown;
  providerRenderId?: string;
  status: string;
  errorMessage?: string;
}) {
  await ensureCreativeSchema();
  const id = crypto.randomUUID();
  await database().prepare(`INSERT INTO creative_render_jobs (
    id, project_id, associate_email, provider, provider_render_id, status,
    render_plan, error_message
  ) VALUES (?, ?, ?, 'shotstack', ?, ?, ?, ?)`)
    .bind(id, input.projectId, input.associateEmail, input.providerRenderId ?? "",
      input.status, JSON.stringify(input.renderPlan), input.errorMessage ?? "").run();
  return database().prepare("SELECT * FROM creative_render_jobs WHERE id = ? LIMIT 1")
    .bind(id).first<CreativeRenderJobRecord>();
}

export async function getLatestRenderJob(projectId: string, associateEmail: string) {
  await ensureCreativeSchema();
  return database().prepare(`SELECT * FROM creative_render_jobs
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
}) {
  await ensureCreativeSchema();
  await database().prepare(`UPDATE creative_render_jobs
    SET status = ?, output_url = ?, storage_key = ?, error_message = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND associate_email = ?`)
    .bind(input.status, input.outputUrl ?? "", input.storageKey ?? "", input.errorMessage ?? "", input.id, input.associateEmail).run();
  return database().prepare("SELECT * FROM creative_render_jobs WHERE id = ? AND associate_email = ? LIMIT 1")
    .bind(input.id, input.associateEmail).first<CreativeRenderJobRecord>();
}

export async function getRenderJob(id: string, associateEmail: string) {
  await ensureCreativeSchema();
  return database().prepare("SELECT * FROM creative_render_jobs WHERE id = ? AND associate_email = ? LIMIT 1")
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
