import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { recordImportEvidence } from "../app/lib/evidence.ts";
import { importedVehicle, SqliteD1, testEnv } from "./harness.mjs";

class MemoryR2 {
  objects = new Map();
  async put(key, body, options) {
    const bytes = body instanceof Uint8Array ? body : new Uint8Array(body);
    this.objects.set(key, { bytes, options });
  }
  async get(key) { return this.objects.get(key) ?? null; }
}

function extracted(overrides = {}) {
  return {
    sourceUrl: "https://dealer.example/vdp/1",
    sourceHost: "dealer.example",
    title: "2026 Test Vehicle",
    vin: "1HGBH41JXMN109186",
    stockNumber: "A1",
    year: "2026",
    make: "Test",
    model: "Vehicle",
    trim: "",
    price: "45000",
    currency: "USD",
    description: "",
    imageUrls: [],
    facts: {},
    evidenceContent: "<!doctype html><title>2026 Test Vehicle - $45,000</title>",
    evidenceContentType: "text/html; charset=utf-8",
    ...overrides,
  };
}

test("evidence storage hashes the exact retained source and captures an optional full-page screenshot", async () => {
  const db = new SqliteD1();
  const media = new MemoryR2();
  const screenshot = Buffer.from("png fixture");
  const env = testEnv({
    DB: db,
    MEDIA: media,
    BROWSER: { quickAction: async () => Response.json({ result: { screenshot: screenshot.toString("base64") } }) },
  });
  try {
    const source = extracted();
    const result = await recordImportEvidence({
      vehicle: importedVehicle(), extracted: source, associateEmail: "joe@example.com",
      dealershipTenant: "dealer.example", purposeNote: "Create a vehicle social post",
    }, env);
    const rows = db.rows("SELECT * FROM import_evidence");
    assert.equal(rows.length, 1);
    assert.equal(rows[0].content_sha256, createHash("sha256").update(source.evidenceContent).digest("hex"));
    assert.equal(Buffer.from(media.objects.get(rows[0].html_storage_key).bytes).toString(), source.evidenceContent);
    assert.equal(Buffer.compare(Buffer.from(media.objects.get(rows[0].screenshot_storage_key).bytes), screenshot), 0);
    assert.equal(result.screenshotStatus, "captured");
  } finally { db.close(); }
});

test("reimporting the same vehicle appends evidence instead of replacing history", async () => {
  const db = new SqliteD1();
  const media = new MemoryR2();
  const env = testEnv({ DB: db, MEDIA: media });
  try {
    const common = { vehicle: importedVehicle(), associateEmail: "joe@example.com", dealershipTenant: "dealer.example" };
    await recordImportEvidence({ ...common, extracted: extracted({ price: "45000" }), purposeNote: "First post" }, env);
    await recordImportEvidence({ ...common, extracted: extracted({ price: "43921", evidenceContent: "<title>Updated price $43,921</title>" }), purposeNote: "Price refresh" }, env);
    const rows = db.rows("SELECT price_at_capture, purpose_note FROM import_evidence ORDER BY rowid");
    assert.deepEqual(rows.map((row) => ({ ...row })), [
      { price_at_capture: "45000", purpose_note: "First post" },
      { price_at_capture: "43921", purpose_note: "Price refresh" },
    ]);
  } finally { db.close(); }
});
