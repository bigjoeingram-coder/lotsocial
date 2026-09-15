import assert from "node:assert/strict";
import test from "node:test";
import { SCHEMA_BOOTSTRAP_SQL } from "../app/lib/schema-bootstrap.ts";
import { repairStatements, TABLES_NEEDING_REPAIR } from "../scripts/i22-generate-repair.mjs";
import { auditSchema, enforcesNotNull } from "../scripts/i22-check-schema.mjs";

/**
 * I-22 regression suite.
 *
 * The deployed database was created by the pre-Rock-1 bootstrap, which declared
 * bare `PRIMARY KEY` on five TEXT id columns. These tests reconstruct that
 * legacy database on real SQLite (via Miniflare's D1), prove the gap is real,
 * and prove the repair closes it without losing rows.
 */

/** The bootstrap as it existed before Rock 1 corrected it. */
function legacySchema() {
  return SCHEMA_BOOTSTRAP_SQL.map((statement) =>
    statement.replace(/TEXT PRIMARY KEY NOT NULL/g, "TEXT PRIMARY KEY"),
  );
}

let counter = 0;

async function legacyDatabase() {
  const { Miniflare } = await import("miniflare");
  counter += 1;
  const mf = new Miniflare({
    modules: true,
    script: "export default { fetch() { return new Response('ok'); } };",
    d1Databases: { DB: `i22-${counter}` },
  });
  const db = await mf.getD1Database("DB");
  for (const statement of legacySchema()) {
    await db.prepare(statement).run();
  }
  return { db, dispose: () => mf.dispose() };
}

async function apply(db, statements) {
  for (const statement of statements) {
    await db.prepare(statement).run();
  }
}

async function tableSql(db, name) {
  const row = await db
    .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name = ?")
    .bind(name)
    .first();
  return row?.sql ?? null;
}

async function insertVehicle(db, id) {
  await db
    .prepare(
      "INSERT INTO imported_vehicles (id, associate_email, source_url, source_host, title, authorization_certified_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(
      id,
      "rep@dealer.example",
      `https://dealer.example/vdp/${id ?? "null"}`,
      "dealer.example",
      "2024 Test Truck",
      "2026-08-29T00:00:00Z",
    )
    .run();
}

test("the legacy schema really does accept a NULL primary key", async () => {
  const { db, dispose } = await legacyDatabase();
  try {
    // If this throws, the premise of I-22 is wrong and the repair is unnecessary.
    await insertVehicle(db, null);
    const row = await db.prepare("SELECT COUNT(*) AS n FROM imported_vehicles WHERE id IS NULL").first();
    assert.equal(row.n, 1, "SQLite should permit NULL in a bare TEXT PRIMARY KEY");

    const sql = await tableSql(db, "imported_vehicles");
    assert.equal(enforcesNotNull(sql, "id"), false);
    const finding = auditSchema([{ name: "imported_vehicles", sql }]).find(
      (entry) => entry.table === "imported_vehicles",
    );
    assert.equal(finding.needsRepair, true);
  } finally {
    await dispose();
  }
});

test("authorization_audit_events needs no repair: INTEGER PRIMARY KEY cannot hold NULL", async () => {
  const { db, dispose } = await legacyDatabase();
  try {
    await db
      .prepare("INSERT INTO authorization_audit_events (id, request_id, actor_type, action) VALUES (?, ?, ?, ?)")
      .bind(null, "req-1", "associate", "created")
      .run();
    const row = await db.prepare("SELECT COUNT(*) AS n FROM authorization_audit_events WHERE id IS NULL").first();
    assert.equal(row.n, 0, "INTEGER PRIMARY KEY is the rowid alias and auto-assigns instead of storing NULL");
    assert.equal(TABLES_NEEDING_REPAIR.includes("authorization_audit_events"), false);
  } finally {
    await dispose();
  }
});

test("the repair enforces NOT NULL on every target column and preserves rows", async () => {
  const { db, dispose } = await legacyDatabase();
  try {
    await insertVehicle(db, "veh-1");
    await insertVehicle(db, "veh-2");

    await apply(db, repairStatements());

    for (const table of TABLES_NEEDING_REPAIR) {
      const sql = await tableSql(db, table);
      assert.ok(sql, `${table} should still exist after the rebuild`);
      assert.equal(sql.includes("__i22"), false, `${table} should not keep the staging name`);
    }

    const findings = auditSchema(
      await Promise.all(
        TABLES_NEEDING_REPAIR.map(async (name) => ({ name, sql: await tableSql(db, name) })),
      ),
    );
    assert.equal(findings.every((finding) => finding.enforced === true), true, "all targets enforce NOT NULL");
    assert.equal(findings.some((finding) => finding.needsRepair), false);

    const rows = await db.prepare("SELECT id FROM imported_vehicles ORDER BY id").all();
    assert.deepEqual(rows.results.map((row) => row.id), ["veh-1", "veh-2"], "rows survive the rebuild");

    await assert.rejects(() => insertVehicle(db, null), "a NULL id must now be rejected");
  } finally {
    await dispose();
  }
});

test("the repair recreates the indexes it dropped", async () => {
  const { db, dispose } = await legacyDatabase();
  try {
    await apply(db, repairStatements());
    const indexes = await db
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name = 'creative_projects'")
      .all();
    const names = indexes.results.map((row) => row.name);
    assert.ok(names.includes("creative_projects_associate_idx"), `missing associate index: ${names.join(", ")}`);
    assert.ok(names.includes("creative_projects_vehicle_idx"), `missing vehicle index: ${names.join(", ")}`);
  } finally {
    await dispose();
  }
});

test("the repair refuses to run when NULL ids already exist", async () => {
  const { db, dispose } = await legacyDatabase();
  try {
    await insertVehicle(db, null);
    // The copy step must fail rather than silently drop or rewrite the bad row,
    // so a database with real NULL ids is escalated instead of quietly altered.
    await assert.rejects(() => apply(db, repairStatements()));
  } finally {
    await dispose();
  }
});
