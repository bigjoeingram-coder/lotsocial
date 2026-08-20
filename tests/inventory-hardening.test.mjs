import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const deleteRoute = await readFile(new URL("../app/api/vdp-imports/delete/route.ts", import.meta.url), "utf8");
const hardeningClient = await readFile(new URL("../app/components/InventoryHardeningClient.tsx", import.meta.url), "utf8");
const renderRoute = await readFile(new URL("../app/api/creative-projects/[id]/render/route.ts", import.meta.url), "utf8");
const layout = await readFile(new URL("../app/layout.tsx", import.meta.url), "utf8");

test("inventory deletion is scoped to the signed-in associate", () => {
  assert.match(deleteRoute, /LOWER\(associate_email\) = LOWER\(\?\)/);
  assert.match(deleteRoute, /DELETE FROM creative_render_jobs/);
  assert.match(deleteRoute, /DELETE FROM creative_projects/);
  assert.match(deleteRoute, /DELETE FROM imported_vehicles/);
  assert.match(deleteRoute, /getChatGPTUser/);
});

test("delete control is mounted globally and calls the scoped endpoint", () => {
  assert.match(layout, /InventoryHardeningClient/);
  assert.match(hardeningClient, /\/api\/vdp-imports\/delete/);
  assert.match(hardeningClient, /Delete vehicle/);
  assert.match(hardeningClient, /window\.confirm/);
});

test("unsafe stale drafts lose copy and render actions", () => {
  assert.match(hardeningClient, /scrapeSource/i);
  assert.match(hardeningClient, /Regeneration required/);
  assert.match(hardeningClient, /\.output-grid button, \.render-gate button/);
  assert.match(renderRoute, /CURRENT_COPY_POLICY_STARTED_AT/);
  assert.match(renderRoute, /requiresRegeneration/);
  assert.match(renderRoute, /regenerationRequired: true/);
  assert.match(renderRoute, /status: 409/);
});
