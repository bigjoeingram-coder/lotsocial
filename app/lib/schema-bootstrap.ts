export type D1StatementLike = {
  bind(...values: unknown[]): D1StatementLike;
  first<T = unknown>(): Promise<T | null>;
  all<T = unknown>(): Promise<{ results: T[] }>;
  run(): Promise<{ meta: { changes: number } }>;
};

export type D1DatabaseLike = {
  prepare(sql: string): D1StatementLike;
  batch<T = unknown>(statements: D1StatementLike[]): Promise<T[]>;
};

export type LotSocialEnvironment = {
  DB?: D1DatabaseLike;
  MEDIA?: R2Bucket;
  IMAGES?: unknown;
  BRIGHTDATA_API_KEY?: string;
  BRIGHTDATA_ZONE?: string;
  SHOTSTACK_API_KEY?: string;
  SHOTSTACK_STAGE?: string;
  LOTSOCIAL_EXPECTED_SITES_HOSTNAME?: string;
  LOTSOCIAL_ASSOCIATE_ALLOWLIST?: string;
  LOTSOCIAL_DAILY_VDP_IMPORT_CAP?: string;
  LOTSOCIAL_DAILY_AUTHORIZATION_REQUEST_CAP?: string;
  LOTSOCIAL_DAILY_MANAGER_EMAIL_CAP?: string;
  LOTSOCIAL_DAILY_BRIGHTDATA_ASSOCIATE_CAP?: string;
  LOTSOCIAL_DAILY_BRIGHTDATA_GLOBAL_CAP?: string;
  LOTSOCIAL_MANAGER_EMAIL_DOMAIN_ALLOWLIST?: string;
  LOTSOCIAL_MANAGEMENT_LINK_TTL_HOURS?: string;
  ENFORCEMENT_API_KEY?: string;
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
};

let schemaReady = new WeakMap<D1DatabaseLike, Promise<void>>();

export function database(env: LotSocialEnvironment, label: string) {
  const db = env.DB;
  if (!db) throw new Error(`The ${label} database is unavailable.`);
  return db;
}

export const SCHEMA_BOOTSTRAP_SQL = [
  `CREATE TABLE IF NOT EXISTS authorization_requests (
    id TEXT PRIMARY KEY NOT NULL,
    approval_token_hash TEXT NOT NULL UNIQUE,
    dealership_name TEXT NOT NULL,
    rooftop_location TEXT NOT NULL,
    dealership_domain TEXT NOT NULL DEFAULT '',
    associate_name TEXT NOT NULL,
    associate_email TEXT NOT NULL,
    manager_name TEXT NOT NULL,
    manager_title TEXT NOT NULL,
    manager_email TEXT NOT NULL,
    manager_phone TEXT NOT NULL DEFAULT '',
    provider_name TEXT NOT NULL DEFAULT 'Unknown',
    provider_contact_name TEXT NOT NULL DEFAULT '',
    provider_contact_email TEXT NOT NULL DEFAULT '',
    requested_permissions TEXT NOT NULL,
    approved_permissions TEXT,
    status TEXT NOT NULL DEFAULT 'requested',
    email_delivery_status TEXT NOT NULL DEFAULT 'pending',
    email_message_id TEXT,
    typed_signature TEXT,
    manager_notes TEXT NOT NULL DEFAULT '',
    terms_version TEXT NOT NULL DEFAULT '2026-07-18-v1',
    requested_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    decided_at TEXT,
    expires_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS authorization_audit_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    request_id TEXT NOT NULL,
    actor_type TEXT NOT NULL,
    actor_email TEXT NOT NULL DEFAULT '',
    action TEXT NOT NULL,
    metadata TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS provider_verifications (
    request_id TEXT PRIMARY KEY NOT NULL,
    verification_token_hash TEXT NOT NULL UNIQUE,
    provider_name TEXT NOT NULL,
    contact_name TEXT NOT NULL,
    contact_email TEXT NOT NULL,
    delivery_method TEXT NOT NULL DEFAULT '',
    feed_format TEXT NOT NULL DEFAULT '',
    connection_notes TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending',
    typed_signature TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    decided_at TEXT,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS authorization_management_links (
    request_id TEXT PRIMARY KEY NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  "CREATE INDEX IF NOT EXISTS authorization_requests_status_idx ON authorization_requests(status, requested_at DESC)",
  "CREATE INDEX IF NOT EXISTS authorization_audit_request_idx ON authorization_audit_events(request_id, created_at ASC)",
  "CREATE INDEX IF NOT EXISTS authorization_management_links_expiry_idx ON authorization_management_links(expires_at)",
  `CREATE TABLE IF NOT EXISTS imported_vehicles (
    id TEXT PRIMARY KEY NOT NULL,
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
  )`,
  "CREATE INDEX IF NOT EXISTS imported_vehicles_associate_idx ON imported_vehicles(associate_email, imported_at DESC)",
  `CREATE TABLE IF NOT EXISTS creative_projects (
    id TEXT PRIMARY KEY NOT NULL,
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
  )`,
  "CREATE INDEX IF NOT EXISTS creative_projects_associate_idx ON creative_projects(associate_email, created_at DESC)",
  "CREATE INDEX IF NOT EXISTS creative_projects_vehicle_idx ON creative_projects(vehicle_id, created_at DESC)",
  `CREATE TABLE IF NOT EXISTS creative_render_jobs (
    id TEXT PRIMARY KEY NOT NULL,
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
  )`,
  "CREATE INDEX IF NOT EXISTS creative_render_jobs_project_idx ON creative_render_jobs(project_id, created_at DESC)",
  "CREATE INDEX IF NOT EXISTS creative_render_jobs_associate_idx ON creative_render_jobs(associate_email, created_at DESC)",
  `CREATE TABLE IF NOT EXISTS rate_limit_counters (
    counter_key TEXT NOT NULL,
    counter_scope TEXT NOT NULL,
    counter_subject TEXT NOT NULL,
    counter_day TEXT NOT NULL,
    count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(counter_key, counter_day)
  )`,
  "CREATE INDEX IF NOT EXISTS rate_limit_counters_scope_day_idx ON rate_limit_counters(counter_scope, counter_day)",
  `CREATE TABLE IF NOT EXISTS import_outcomes (
    id TEXT PRIMARY KEY NOT NULL,
    associate_email TEXT NOT NULL,
    source_host TEXT NOT NULL,
    outcome TEXT NOT NULL,
    elapsed_ms INTEGER NOT NULL,
    fallback TEXT NOT NULL DEFAULT 'none',
    bright_data_used INTEGER NOT NULL DEFAULT 0,
    notice TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  "CREATE INDEX IF NOT EXISTS import_outcomes_created_idx ON import_outcomes(created_at DESC)",
  "CREATE INDEX IF NOT EXISTS import_outcomes_host_created_idx ON import_outcomes(source_host, created_at DESC)",
];

export function ensureLotSocialSchema(env: LotSocialEnvironment) {
  const db = database(env, "LotSocial");
  if (!schemaReady.has(db)) {
    const ready = db.batch(SCHEMA_BOOTSTRAP_SQL.map((statement) => db.prepare(statement)))
      .then(() => undefined)
      .catch((error) => {
        // A transient bootstrap failure must not poison this Worker isolate.
        // Remove only this attempt so the next request can retry safely.
        if (schemaReady.get(db) === ready) schemaReady.delete(db);
        throw error;
      });
    schemaReady.set(db, ready);
  }
  return schemaReady.get(db)!;
}

export function resetSchemaBootstrapForTests() {
  schemaReady = new WeakMap<D1DatabaseLike, Promise<void>>();
}
