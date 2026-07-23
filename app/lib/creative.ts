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
  return Object.values(facts).filter(Boolean).slice(0, 3);
}

function createCopy(vehicle: ImportedVehicleRecord, style: string, durationSeconds: number, endCardName: string, endCardCta: string) {
  const name = vehicleName(vehicle);
  const highlights = groundedHighlights(vehicle);
  const priceLine = vehicle.price ? `It was listed at ${displayPrice(vehicle.price)} when this vehicle page was captured.` : "Contact me for current pricing and availability.";
  const detailLine = highlights.length ? `Highlights listed by the dealership include ${highlights.join(", ")}.` : "Open the original dealership listing for the complete equipment and feature details.";
  const openings: Record<string, string[]> = {
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
  const socialCaption = `${name}${vehicle.price ? ` · ${displayPrice(vehicle.price)} as listed` : ""}\n\n${highlights.length ? `${highlights.join(" · ")}\n\n` : ""}${endCardCta}. Confirm price, availability, and eligibility with the dealership.\n\n#${vehicle.make.replace(/\s+/g, "")} #${vehicle.model.replace(/\s+/g, "")} #CarSales`;
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
}) {
  await ensureCreativeSchema();
  const id = crypto.randomUUID();
  const copy = createCopy(input.vehicle, input.style, input.durationSeconds, input.endCardName, input.endCardCta);
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
  errorMessage?: string;
}) {
  await ensureCreativeSchema();
  await database().prepare(`UPDATE creative_render_jobs
    SET status = ?, output_url = ?, error_message = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND associate_email = ?`)
    .bind(input.status, input.outputUrl ?? "", input.errorMessage ?? "", input.id, input.associateEmail).run();
  return database().prepare("SELECT * FROM creative_render_jobs WHERE id = ? AND associate_email = ? LIMIT 1")
    .bind(input.id, input.associateEmail).first<CreativeRenderJobRecord>();
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
    errorMessage: record.error_message,
    summary: plan.summary ?? null,
    createdAt: record.created_at,
    updatedAt: record.updated_at,
  };
}
