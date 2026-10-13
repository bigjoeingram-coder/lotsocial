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
  BROWSER?: { quickAction(action: string, input: Record<string, unknown>): Promise<Response> };
  BRIGHTDATA_API_KEY?: string;
  BRIGHTDATA_ZONE?: string;
  SHOTSTACK_API_KEY?: string;
  SHOTSTACK_STAGE?: string;
  LOTSOCIAL_EXPECTED_SITES_HOSTNAME?: string;
  LOTSOCIAL_RENDER_PROXY_ORIGIN?: string;
  LOTSOCIAL_RENDER_PROXY_SECRET?: string;
  LOTSOCIAL_ASSOCIATE_ALLOWLIST?: string;
  LOTSOCIAL_DAILY_VDP_IMPORT_CAP?: string;
  LOTSOCIAL_DAILY_AUTHORIZATION_REQUEST_CAP?: string;
  LOTSOCIAL_DAILY_MANAGER_EMAIL_CAP?: string;
  LOTSOCIAL_DAILY_BRIGHTDATA_ASSOCIATE_CAP?: string;
  LOTSOCIAL_DAILY_BRIGHTDATA_GLOBAL_CAP?: string;
  LOTSOCIAL_MANAGER_EMAIL_DOMAIN_ALLOWLIST?: string;
  LOTSOCIAL_MANAGEMENT_LINK_TTL_HOURS?: string;
  OPENAI_API_KEY?: string;
  IMAGE_MODERATION_API_KEY?: string;
  ENFORCEMENT_API_KEY?: string;
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
  LOTSOCIAL_SESSION_TTL_HOURS?: string;
};

let schemaReady = new WeakMap<D1DatabaseLike, Promise<void>>();

export function database(env: LotSocialEnvironment, label: string) {
  const db = env.DB;
  if (!db) throw new Error(`The ${label} database is unavailable.`);
  return db;
}

export const SCHEMA_BOOTSTRAP_SQL = [
  `CREATE TABLE IF NOT EXISTS pilot_invites (
    id TEXT PRIMARY KEY NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    email TEXT NOT NULL,
    dealership_name TEXT NOT NULL,
    dealership_domain TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    used_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  "CREATE INDEX IF NOT EXISTS pilot_invites_email_idx ON pilot_invites(email, created_at DESC)",
  `CREATE TABLE IF NOT EXISTS associate_accounts (
    id TEXT PRIMARY KEY NOT NULL,
    email TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    phone TEXT NOT NULL DEFAULT '',
    dealership_name TEXT NOT NULL,
    dealership_domain TEXT NOT NULL,
    rooftop_location TEXT NOT NULL DEFAULT '',
    profile_photo_url TEXT NOT NULL DEFAULT '',
    role TEXT NOT NULL DEFAULT 'associate',
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS associate_sessions (
    id TEXT PRIMARY KEY NOT NULL,
    account_id TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    revoked_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  "CREATE INDEX IF NOT EXISTS associate_sessions_account_idx ON associate_sessions(account_id, created_at DESC)",
  "CREATE INDEX IF NOT EXISTS associate_sessions_expiry_idx ON associate_sessions(expires_at)",
  `CREATE TABLE IF NOT EXISTS account_login_links (
    id TEXT PRIMARY KEY NOT NULL,
    account_id TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    used_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  "CREATE INDEX IF NOT EXISTS account_login_links_account_idx ON account_login_links(account_id, created_at DESC)",
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
    terms_version TEXT NOT NULL DEFAULT '2026-09-14-v2',
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
  `CREATE TABLE IF NOT EXISTS import_evidence (
    id TEXT PRIMARY KEY NOT NULL,
    vehicle_id TEXT NOT NULL,
    associate_email TEXT NOT NULL,
    dealership_tenant TEXT NOT NULL,
    source_url TEXT NOT NULL,
    source_host TEXT NOT NULL,
    captured_at TEXT NOT NULL,
    content_sha256 TEXT NOT NULL,
    html_storage_key TEXT NOT NULL,
    screenshot_storage_key TEXT NOT NULL DEFAULT '',
    screenshot_status TEXT NOT NULL DEFAULT 'unavailable',
    price_at_capture TEXT NOT NULL DEFAULT '',
    currency TEXT NOT NULL DEFAULT 'USD',
    vin_at_capture TEXT NOT NULL DEFAULT '',
    stock_at_capture TEXT NOT NULL DEFAULT '',
    title_at_capture TEXT NOT NULL,
    purpose_project_id TEXT,
    purpose_note TEXT NOT NULL,
    source_type TEXT NOT NULL DEFAULT 'vdp_one_time',
    content_type TEXT NOT NULL DEFAULT 'text/html; charset=utf-8',
    storage_bytes INTEGER NOT NULL DEFAULT 0
  )`,
  "CREATE INDEX IF NOT EXISTS import_evidence_vehicle_idx ON import_evidence(vehicle_id, captured_at DESC)",
  "CREATE INDEX IF NOT EXISTS import_evidence_tenant_idx ON import_evidence(dealership_tenant, captured_at DESC)",
  "CREATE INDEX IF NOT EXISTS import_evidence_associate_idx ON import_evidence(associate_email, captured_at DESC)",
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
    end_card_photo_url TEXT NOT NULL DEFAULT '',
    disclaimer_version TEXT NOT NULL DEFAULT '2026-09-14-v1',
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
  // Posting engine v1 (migration 0013).
  `CREATE TABLE IF NOT EXISTS delivery_attempts (
      id text PRIMARY KEY NOT NULL,
      slot_id text NOT NULL,
      idempotency_key text NOT NULL,
      adapter text NOT NULL,
      request_snapshot text DEFAULT '{}' NOT NULL,
      outcome text DEFAULT 'in_flight' NOT NULL,
      platform_post_id text DEFAULT '' NOT NULL,
      platform_url text DEFAULT '' NOT NULL,
      provider_request_id text DEFAULT '' NOT NULL,
      error_code text DEFAULT '' NOT NULL,
      error_message text DEFAULT '' NOT NULL,
      retryable integer DEFAULT 0 NOT NULL,
      raw_response_key text DEFAULT '' NOT NULL,
      started_at text NOT NULL,
      finished_at text,
      last_checked_at text
  )`,
  "CREATE INDEX IF NOT EXISTS delivery_attempts_slot_idx ON delivery_attempts (slot_id,started_at)",
  `CREATE TABLE IF NOT EXISTS post_slots (
      id text PRIMARY KEY NOT NULL,
      variant_id text NOT NULL,
      destination_id text NOT NULL,
      scheduled_at_utc text NOT NULL,
      timezone text DEFAULT 'UTC' NOT NULL,
      slot_status text DEFAULT 'DRAFT' NOT NULL,
      idempotency_key text NOT NULL,
      approved_revision_hash text DEFAULT '' NOT NULL,
      worker_id text DEFAULT '' NOT NULL,
      attempt_id text DEFAULT '' NOT NULL,
      claimed_at text,
      lease_expires_at text,
      attempt_count integer DEFAULT 0 NOT NULL,
      next_retry_at text,
      uncertain_since text,
      created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
      updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL
  )`,
  "CREATE UNIQUE INDEX IF NOT EXISTS post_slots_idempotency_key_unique ON post_slots (idempotency_key)",
  "CREATE INDEX IF NOT EXISTS post_slots_due_idx ON post_slots (slot_status,scheduled_at_utc)",
  "CREATE INDEX IF NOT EXISTS post_slots_lease_idx ON post_slots (slot_status,lease_expires_at)",
  "CREATE INDEX IF NOT EXISTS post_slots_variant_idx ON post_slots (variant_id)",
  `CREATE TABLE IF NOT EXISTS post_variants (
      id text PRIMARY KEY NOT NULL,
      creative_project_id text NOT NULL,
      destination_id text NOT NULL,
      platform text NOT NULL,
      caption text DEFAULT '' NOT NULL,
      title text DEFAULT '' NOT NULL,
      description text DEFAULT '' NOT NULL,
      platform_options text DEFAULT '{}' NOT NULL,
      render_job_id text DEFAULT '' NOT NULL,
      media_storage_key text DEFAULT '' NOT NULL,
      revision integer DEFAULT 1 NOT NULL,
      revision_hash text NOT NULL,
      approval_status text DEFAULT 'DRAFT' NOT NULL,
      approved_revision_hash text DEFAULT '' NOT NULL,
      approved_by text DEFAULT '' NOT NULL,
      approved_at text,
      validation_status text DEFAULT 'unchecked' NOT NULL,
      validation_errors text DEFAULT '[]' NOT NULL,
      supersedes_id text,
      created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
      updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL
  )`,
  "CREATE INDEX IF NOT EXISTS post_variants_project_idx ON post_variants (creative_project_id,created_at)",
  `CREATE TABLE IF NOT EXISTS posting_audit_events (
      id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
      slot_id text DEFAULT '' NOT NULL,
      variant_id text DEFAULT '' NOT NULL,
      actor_type text NOT NULL,
      actor_email text DEFAULT '' NOT NULL,
      action text NOT NULL,
      metadata text DEFAULT '{}' NOT NULL,
      created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL
  )`,
  "CREATE INDEX IF NOT EXISTS posting_audit_slot_idx ON posting_audit_events (slot_id,created_at)",
  "CREATE INDEX IF NOT EXISTS posting_audit_variant_idx ON posting_audit_events (variant_id,created_at)",
  `CREATE TABLE IF NOT EXISTS social_connections (
      id text PRIMARY KEY NOT NULL,
      owner_email text NOT NULL,
      platform text NOT NULL,
      account_label text DEFAULT '' NOT NULL,
      credentials_ref text DEFAULT '' NOT NULL,
      granted_scopes text DEFAULT '[]' NOT NULL,
      health_state text DEFAULT 'UNVERIFIED' NOT NULL,
      health_checked_at text,
      last_success_at text,
      status text DEFAULT 'active' NOT NULL,
      created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
      updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL
  )`,
  "CREATE INDEX IF NOT EXISTS social_connections_owner_idx ON social_connections (owner_email,platform)",
  `CREATE TABLE IF NOT EXISTS social_destinations (
      id text PRIMARY KEY NOT NULL,
      connection_id text NOT NULL,
      platform text NOT NULL,
      platform_ref text NOT NULL,
      kind text DEFAULT 'member' NOT NULL,
      display_name text DEFAULT '' NOT NULL,
      status text DEFAULT 'active' NOT NULL,
      created_at text DEFAULT CURRENT_TIMESTAMP NOT NULL,
      updated_at text DEFAULT CURRENT_TIMESTAMP NOT NULL
  )`,
  "CREATE UNIQUE INDEX IF NOT EXISTS social_destinations_connection_ref_unique ON social_destinations (connection_id,platform_ref)",
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
