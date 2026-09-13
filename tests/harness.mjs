import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

export const signedInUser = {
  displayName: "Joe Associate",
  email: "joe@example.com",
  fullName: "Joe Associate",
};

export function testEnv(overrides = {}) {
  return {
    LOTSOCIAL_EXPECTED_SITES_HOSTNAME: "lotsocial.test",
    LOTSOCIAL_ASSOCIATE_ALLOWLIST: signedInUser.email,
    LOTSOCIAL_DAILY_VDP_IMPORT_CAP: "25",
    LOTSOCIAL_DAILY_AUTHORIZATION_REQUEST_CAP: "10",
    LOTSOCIAL_DAILY_MANAGER_EMAIL_CAP: "5",
    LOTSOCIAL_MANAGER_EMAIL_DOMAIN_ALLOWLIST: "",
    ...overrides,
  };
}

export async function json(response) {
  return response.json();
}

export function jsonRequest(url, method, body) {
  return new Request(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

class FakeStatement {
  constructor(db, sql) {
    this.db = db;
    this.sql = sql;
    this.values = [];
  }

  bind(...values) {
    const statement = new FakeStatement(this.db, this.sql);
    statement.values = values;
    return statement;
  }

  async first() {
    return this.db.first(this.sql, this.values);
  }

  async all() {
    return { results: this.db.all(this.sql, this.values) };
  }

  async run() {
    return { meta: { changes: this.db.run(this.sql, this.values) } };
  }
}

export class FakeD1 {
  constructor(seed = {}) {
    this.importedVehicles = [...(seed.importedVehicles ?? [])];
    this.creativeProjects = [...(seed.creativeProjects ?? [])];
    this.creativeRenderJobs = [...(seed.creativeRenderJobs ?? [])];
    this.rateLimitCounters = new Map();
    this.preparedSql = [];
    this.failOnSql = seed.failOnSql ?? "";
  }

  prepare(sql) {
    this.preparedSql.push(sql);
    return new FakeStatement(this, sql);
  }

  async batch(statements) {
    const snapshot = {
      importedVehicles: structuredClone(this.importedVehicles),
      creativeProjects: structuredClone(this.creativeProjects),
      creativeRenderJobs: structuredClone(this.creativeRenderJobs),
      rateLimitCounters: structuredClone(this.rateLimitCounters),
    };
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      return results;
    } catch (error) {
      this.importedVehicles = snapshot.importedVehicles;
      this.creativeProjects = snapshot.creativeProjects;
      this.creativeRenderJobs = snapshot.creativeRenderJobs;
      this.rateLimitCounters = snapshot.rateLimitCounters;
      throw error;
    }
  }

  first(sql, values) {
    if (matches(sql, "INSERT INTO rate_limit_counters")) {
      const [counterKey, counterScope, counterSubject, counterDay] = values;
      const key = `${counterKey}:${counterDay}`;
      const current = this.rateLimitCounters.get(key) ?? {
        counter_key: counterKey,
        counter_scope: counterScope,
        counter_subject: counterSubject,
        counter_day: counterDay,
        count: 0,
      };
      current.count += 1;
      this.rateLimitCounters.set(key, current);
      return { count: current.count };
    }
    if (matches(sql, "SELECT id FROM imported_vehicles")) {
      const [associateEmail, ...sourceUrls] = values;
      return this.importedVehicles.find((vehicle) =>
        sameEmail(vehicle.associate_email, associateEmail) && sourceUrls.includes(vehicle.source_url)
      ) ?? null;
    }
    assert.fail(`Unexpected first() SQL: ${sql}`);
  }

  all(sql, values) {
    if (matches(sql, "SELECT id FROM creative_projects")) {
      const [vehicleId, associateEmail] = values;
      return this.creativeProjects
        .filter((project) => project.vehicle_id === vehicleId && sameEmail(project.associate_email, associateEmail))
        .map((project) => ({ id: project.id }));
    }
    assert.fail(`Unexpected all() SQL: ${sql}`);
  }

  run(sql, values) {
    if (this.failOnSql && matches(sql, this.failOnSql)) throw new Error(`Injected batch failure: ${this.failOnSql}`);
    if (matches(sql, "CREATE TABLE") || matches(sql, "CREATE INDEX")) return 0;
    if (matches(sql, "DELETE FROM creative_render_jobs")) {
      if (matches(sql, "SELECT id FROM creative_projects")) {
        const [associateEmail, vehicleId, projectAssociateEmail] = values;
        const projectIds = new Set(this.creativeProjects
          .filter((project) => project.vehicle_id === vehicleId && sameEmail(project.associate_email, projectAssociateEmail))
          .map((project) => project.id));
        return removeMatching(this.creativeRenderJobs, (job) =>
          projectIds.has(job.project_id) && sameEmail(job.associate_email, associateEmail)
        );
      }
      const [projectId, associateEmail] = values;
      return removeMatching(this.creativeRenderJobs, (job) =>
        job.project_id === projectId && sameEmail(job.associate_email, associateEmail)
      );
    }
    if (matches(sql, "DELETE FROM creative_projects")) {
      const [vehicleId, associateEmail] = values;
      return removeMatching(this.creativeProjects, (project) =>
        project.vehicle_id === vehicleId && sameEmail(project.associate_email, associateEmail)
      );
    }
    if (matches(sql, "DELETE FROM imported_vehicles")) {
      const [vehicleId, associateEmail] = values;
      return removeMatching(this.importedVehicles, (vehicle) =>
        vehicle.id === vehicleId && sameEmail(vehicle.associate_email, associateEmail)
      );
    }
    assert.fail(`Unexpected run() SQL: ${sql}`);
  }
}

class SqliteStatement {
  constructor(db, sql) {
    this.db = db;
    this.sql = sql;
    this.values = [];
  }

  bind(...values) {
    const statement = new SqliteStatement(this.db, this.sql);
    statement.values = values;
    return statement;
  }

  async first() {
    return this.db.prepare(this.sql).get(...this.values) ?? null;
  }

  async all() {
    return { results: this.db.prepare(this.sql).all(...this.values) };
  }

  async run() {
    const result = this.db.prepare(this.sql).run(...this.values);
    return { meta: { changes: result.changes } };
  }
}

export class SqliteD1 {
  constructor() {
    this.db = new DatabaseSync(":memory:");
  }

  prepare(sql) {
    return new SqliteStatement(this.db, sql);
  }

  async batch(statements) {
    return Promise.all(statements.map((statement) => statement.run()));
  }

  close() {
    this.db.close();
  }

  rows(sql, ...values) {
    return this.db.prepare(sql).all(...values);
  }
}

function matches(sql, fragment) {
  return sql.replace(/\s+/g, " ").trim().toLowerCase().includes(fragment.toLowerCase());
}

function sameEmail(left, right) {
  return String(left).toLowerCase() === String(right).toLowerCase();
}

function removeMatching(rows, predicate) {
  const before = rows.length;
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    if (predicate(rows[index])) rows.splice(index, 1);
  }
  return before - rows.length;
}

export function importedVehicle(overrides = {}) {
  return {
    id: "veh_1",
    associate_email: "joe@example.com",
    source_url: "https://dealer.example/vdp/1",
    source_host: "dealer.example",
    title: "2026 Test Vehicle",
    vin: "1HGBH41JXMN109186",
    stock_number: "A1",
    year: "2026",
    make: "Test",
    model: "Vehicle",
    trim: "",
    price: "45000",
    currency: "USD",
    description: "",
    image_urls: "[]",
    facts: "{}",
    source_type: "vdp_one_time",
    authorization_certified_at: "2026-08-29T00:00:00.000Z",
    imported_at: "2026-08-29 00:00:00",
    updated_at: "2026-08-29 00:00:00",
    ...overrides,
  };
}

export async function startTier2Worker(bindings = {}) {
  const { Miniflare } = await loadMiniflare();
  const modules = (await serverModules("dist/server")).map((path) => ({
    type: "ESModule",
    path,
  }));
  const mf = new Miniflare({
    modules,
    compatibilityDate: "2026-05-15",
    compatibilityFlags: ["nodejs_compat"],
    scriptPath: "dist/server/index.js",
    d1Databases: ["DB"],
    bindings: testEnv(bindings),
  });

  return {
    fetch: (input, init) => mf.dispatchFetch(input, init),
    dispose: () => mf.dispose(),
  };
}

async function loadMiniflare() {
  try {
    return await import("miniflare");
  } catch (error) {
    throw new Error("Miniflare is required for Tier 2 worker tests. Install project devDependencies before running tests.", {
      cause: error,
    });
  }
}

async function serverModules(directory) {
  const entries = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name).replaceAll("\\", "/");
    if (entry.isDirectory()) {
      entries.push(...await serverModules(path));
    } else if (entry.isFile() && path.endsWith(".js")) {
      entries.push(path);
    }
  }
  return entries;
}
