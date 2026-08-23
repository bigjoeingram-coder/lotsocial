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
const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

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
  assert.doesNotMatch(renderer, /effect: pace/);
});

test("rendered vehicle media fills dead space with same-image wallpaper and starts on vehicle pixels", () => {
  assert.match(renderer, /const WALLPAPER_BACKGROUND_SCALE = 1\.18/);
  assert.match(renderer, /const WALLPAPER_BACKGROUND_OPACITY = 0\.38/);
  assert.match(renderer, /const WALLPAPER_TINT_OPACITY = 0\.94/);
  assert.match(renderer, /const wallpaperClips = timedImages\.map/);
  assert.match(renderer, /const wallpaperTintClips = timedImages\.map/);
  assert.match(renderer, /fit: "crop"/);
  assert.match(renderer, /scale: WALLPAPER_BACKGROUND_SCALE/);
  assert.match(renderer, /opacity: WALLPAPER_BACKGROUND_OPACITY/);
  assert.match(renderer, /filter: "darken"/);
  assert.match(renderer, /background:#071116/);
  assert.match(renderer, /opacity: WALLPAPER_TINT_OPACITY/);
  assert.match(renderer, /transition: index === 0 \? \{ out: "fade" \} : \{ in: "fade", out: "fade" \}/);
  assert.match(renderer, /\{ clips: wallpaperTintClips \}/);
  assert.match(renderer, /\{ clips: wallpaperClips \}/);
  assert.match(renderer, /darker same-image wallpaper fill/);
});

test("rendered video ends with branded salesperson end card", () => {
  assert.match(renderer, /const endCardPhone = project\.end_card_phone \? `<div class="phone">\$\{escapeHtml\(project\.end_card_phone\)\}<\/div>` : ""/);
  assert.match(renderer, /const endCardEmail = project\.end_card_email \? `<div class="email">\$\{escapeHtml\(project\.end_card_email\)\}<\/div>` : ""/);
  assert.match(renderer, /class="end-card"/);
  assert.match(renderer, /class="content"/);
  assert.match(renderer, /class="contact"/);
  assert.match(renderer, /<b>LotSocial<\/b>/);
  assert.match(renderer, /html,body\{margin:0\}/);
  assert.match(renderer, /left:190px;right:190px;top:560px/);
  assert.match(renderer, /\.phone\{display:block;margin:8px auto 0;color:#e8f1eb;font-size:29px;line-height:1\.22;font-weight:900/);
  assert.match(renderer, /\.email\{display:block;margin:10px auto 0;color:#e8f1eb;font-size:24px;line-height:1\.22;font-weight:650/);
  assert.match(renderer, /text-align:center/);
  assert.match(renderer, /overflow-wrap:anywhere/);
  assert.match(renderer, /escapeHtml\(project\.end_card_cta\)/);
  assert.match(renderer, /escapeHtml\(project\.end_card_name\)/);
  assert.match(renderer, /escapeHtml\(vehicleLine\(vehicle\)\)/);
  assert.match(renderer, /css: endCardCss/);
  assert.match(renderer, /branded salesperson end card/);
});

test("creative shot picker uses swipeable four-photo pages on mobile", () => {
  assert.match(app, /function chunkImages\(images: string\[\], size = 4\)/);
  assert.match(app, /Swipe groups of four/);
  assert.match(app, /className="creative-photo-page"/);
  assert.match(app, /pageIndex \* 4 \+ imageIndex/);
  assert.match(css, /\.creative-photo-grid \{ display: flex; gap: 12px; overflow-x: auto; overflow-y: hidden; scroll-snap-type: x mandatory/);
  assert.match(css, /\.creative-photo-page \{ flex: 0 0 100%; display: grid; grid-template-columns: repeat\(2,minmax\(0,1fr\)\); gap: 10px; scroll-snap-align: start; \}/);
  assert.match(css, /\.creative-photo-grid button \{ position: relative; aspect-ratio: 4 \/ 3/);
  assert.match(css, /\.creative-photo-grid img \{ width: 100%; height: 100%; object-fit: contain/);
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
