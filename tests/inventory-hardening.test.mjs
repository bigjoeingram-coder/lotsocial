import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const deleteRoute = await readFile(new URL("../app/api/vdp-imports/delete/route.ts", import.meta.url), "utf8");
const hardeningClient = await readFile(new URL("../app/components/InventoryHardeningClient.tsx", import.meta.url), "utf8");
const renderRoute = await readFile(new URL("../app/api/creative-projects/[id]/render/route.ts", import.meta.url), "utf8");
const renderer = await readFile(new URL("../app/lib/rendering.ts", import.meta.url), "utf8");
const creative = await readFile(new URL("../app/lib/creative.ts", import.meta.url), "utf8");
const layout = await readFile(new URL("../app/layout.tsx", import.meta.url), "utf8");
const app = await readFile(new URL("../app/components/AuthorizationApp.tsx", import.meta.url), "utf8");

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
  assert.match(hardeningClient, /sessionStorage\.setItem\("lotsocial-return-view", "inventory"\)/);
  assert.match(app, /sessionStorage\.getItem\("lotsocial-return-view"\)/);
  assert.match(app, /setView\("inventory"\)/);
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

test("renderer retries alternate Shotstack stage after auth rejection", () => {
  assert.match(renderer, /const stages: ShotstackStage\[\]/);
  assert.match(renderer, /response\.status === 401 \|\| response\.status === 403/);
  assert.match(renderer, /providerRenderId: `\$\{candidateStage\}:\$\{payload\.response\.id\}`/);
  assert.match(renderer, /video renderer rejected the current provider credentials/i);
  assert.match(renderer, /parseProviderRenderId/);
});

test("rendered vehicle media uses inspection-fit framing", () => {
  assert.match(renderer, /const INSPECTION_IMAGE_SCALE = 0\.92/);
  assert.match(renderer, /fit: "contain"/);
  assert.match(renderer, /scale: INSPECTION_IMAGE_SCALE/);
  assert.match(renderer, /position: "center"/);
  assert.doesNotMatch(renderer, /fit: "crop"/);
  assert.doesNotMatch(renderer, /effect: pace/);
});

test("completed render offers iOS photo-saving share path", () => {
  assert.match(app, /saveRenderedVideoToPhotos/);
  assert.match(app, /navigator\.canShare\?\.\(\{ files: \[file\] \}\)/);
  assert.match(app, /navigator\.share\(\{ files: \[file\]/);
  assert.match(app, /Save to Photos/);
  assert.match(app, /Download MP4/);
});

test("creative copy normalizes escaped VDP HTML before captions", () => {
  assert.match(creative, /function decodeHtmlEntities/);
  assert.match(creative, /function cleanCopyLine/);
  assert.match(creative, /function cleanCopyBlock/);
  assert.match(creative, /&lt;/);
  assert.match(creative, /&gt;/);
  assert.match(creative, /&#0\*39;/);
  assert.match(creative, /return \{ voiceoverScript: cleanCopyBlock\(voiceoverScript\), socialCaption: cleanCopyBlock\(socialCaption\) \}/);
});
