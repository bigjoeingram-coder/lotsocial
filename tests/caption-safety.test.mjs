import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const projectRoot = new URL("../", import.meta.url);

async function source(path) {
  return readFile(new URL(path, projectRoot), "utf8");
}

// Regression: a published caption once contained the literal string
// "scrapeSource: Dealer Inspire inventory listing" because groundedHighlights()
// iterated every fact key and fell back to the raw key name as its label.
test("caption highlights use an allowlist so provenance keys cannot leak", async () => {
  const creative = await source("app/lib/creative.ts");

  assert.doesNotMatch(
    creative,
    /labels\[key\]\s*\?\?\s*key/,
    "groundedHighlights must not fall back to the raw fact key as a label",
  );
  assert.match(
    creative,
    /Object\.hasOwn\(labels,\s*key\)/,
    "groundedHighlights must filter facts through the labels allowlist",
  );
});

test("groundedHighlights allowlist logic drops provenance keys", () => {
  // Mirrors the implementation in app/lib/creative.ts.
  const labels = {
    mileage: "Mileage",
    exteriorColor: "Exterior",
    interiorColor: "Interior",
    transmission: "Transmission",
    fuelType: "Fuel",
    drivetrain: "Drivetrain",
    bodyStyle: "Body style",
  };
  const groundedHighlights = (facts) =>
    Object.entries(facts)
      .filter(([key, value]) => Object.hasOwn(labels, key) && typeof value === "string" && Boolean(value.trim()))
      .map(([key, value]) => `${labels[key]}: ${value.trim()}`)
      .slice(0, 4);

  const highlights = groundedHighlights({
    dealershipName: "Newport Lexus",
    exteriorColor: "Nero Ribelle",
    scrapeSource: "Dealer Inspire inventory listing",
    sourceType: "unlocker_markdown",
    sourceHost: "www.newportlexus.com",
    importedAt: "2026-08-15T00:00:00Z",
    rawText: "…",
  });

  assert.deepEqual(highlights, ["Exterior: Nero Ribelle"]);
  assert.doesNotMatch(
    highlights.join(" "),
    /scrape|source|imported|rawText/i,
    "no provenance key may appear in customer-facing highlights",
  );
});

// The Bright Data Web Unlocker fallback fails open (returns null) when its
// credentials are unset, which silently disables VDP extraction in production.
test("Bright Data credentials are documented in .env.example", async () => {
  const [envExample, vdp] = await Promise.all([
    source(".env.example"),
    source("app/lib/vdp.ts"),
  ]);

  for (const key of ["BRIGHTDATA_API_KEY", "BRIGHTDATA_ZONE"]) {
    assert.match(vdp, new RegExp(key), `${key} should be read by app/lib/vdp.ts`);
    assert.match(
      envExample,
      new RegExp(`^${key}=`, "m"),
      `${key} is required by app/lib/vdp.ts but is missing from .env.example`,
    );
  }
});

// The inventory card is the primary mobile affordance: a salesperson should be
// able to tap the vehicle rather than scroll to a button.
test("inventory vehicle cards are keyboard accessible and clickable", async () => {
  const app = await source("app/components/AuthorizationApp.tsx");

  assert.match(app, /className="vehicle-card is-clickable"/, "vehicle card should carry the clickable class");
  assert.match(app, /role="button"/, "clickable card needs a button role");
  assert.match(app, /tabIndex=\{0\}/, "clickable card must be focusable");
  assert.match(app, /onKeyDown=/, "clickable card must respond to Enter and Space");
  assert.match(
    app,
    /rel="noreferrer" onClick=\{\(event\) => event\.stopPropagation\(\)\}/,
    "the View source link must not trigger card navigation",
  );
});
