import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

const projectRoot = new URL("../", import.meta.url);

async function source(path) {
  return readFile(new URL(path, projectRoot), "utf8");
}

test("ships the LotSocial product instead of the disposable starter", async () => {
  const [page, layout, packageJson] = await Promise.all([
    source("app/page.tsx"),
    source("app/layout.tsx"),
    source("package.json"),
  ]);

  assert.match(page, /AuthorizationApp/);
  assert.match(layout, /LotSocial Inventory Authorization/);
  assert.doesNotMatch(page, /SkeletonPreview|codex-preview/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  assert.deepEqual(await readdir(new URL("app/_sites-preview", projectRoot)), []);
});

test("includes the mobile Add to Home Screen pilot banner", async () => {
  const [component, css] = await Promise.all([
    source("app/components/AuthorizationApp.tsx"),
    source("app/globals.css"),
  ]);

  assert.match(component, /lotsocial-install-banner-dismissed/);
  assert.match(component, /Add LotSocial to your home screen/);
  assert.match(component, />iPhone</);
  assert.match(component, />Android</);
  assert.match(component, /open this page in Safari/);
  assert.match(component, /setInstallHelp\(installHelp === "ios" \? null : "ios"\)/);
  assert.match(component, /setInstallHelp\(installHelp === "android" \? null : "android"\)/);
  assert.match(css, /\.install-banner/);
  assert.match(css, /\.install-steps/);
});

test("keeps the inventory lane scrape-only, not manual-entry based", async () => {
  const [component, route, creativeRoute, vdp] = await Promise.all([
    source("app/components/AuthorizationApp.tsx"),
    source("app/api/vdp-imports/route.ts"),
    source("app/api/creative-projects/route.ts"),
    source("app/lib/vdp.ts"),
  ]);

  assert.doesNotMatch(component, /manualVehicle|Save manual vehicle|manual details|source-stamped manual/);
  assert.doesNotMatch(route, /manualVehicle|createManualVehicle/);
  assert.doesNotMatch(vdp, /ManualVehicleInput|createManualVehicle|Manual vehicle entry/);
  assert.match(route, /payload\.authorizedToMarket !== true/);
  assert.match(component, /Create social caption/);
  assert.match(component, /Caption-only draft/);
  assert.doesNotMatch(creativeRoute, /selectedImages\.length < 2/);
});

test("uses a browser-like request signature for public VDP reads", async () => {
  const vdp = await source("app/lib/vdp.ts");

  assert.match(vdp, /Mozilla\/5\.0/);
  assert.match(vdp, /Accept-Language/);
  assert.match(vdp, /Cache-Control/);
  assert.match(vdp, /Referer: requestedUrl\.origin/);
});

test("detects Cloudflare challenges and bounds fallback work", async () => {
  const vdp = await source("app/lib/vdp.ts");

  assert.match(vdp, /const IMPORT_DEADLINE_MS = 24_000/);
  assert.match(vdp, /const DIRECT_FETCH_MS = 8_000/);
  assert.match(vdp, /const READER_FETCH_MS = 6_000/);
  assert.match(vdp, /const MAX_READER_ATTEMPTS = 6/);
  assert.match(vdp, /export function isCloudflareChallenge/);
  assert.match(vdp, /cf-chl/);
  assert.match(vdp, /cdn-cgi\\\/challenge-platform/);
  assert.match(vdp, /just a moment/);
  assert.match(vdp, /attention required/);
  assert.match(vdp, /checking if the site connection is secure/);
  assert.match(vdp, /extractFromDealerInspireListing\(requestedUrl, deadline\)/);
  assert.match(vdp, /LotSocial could not scrape that VDP before the dealer page timed out/);
});

test("keeps reader URLs isolated and covered for public inventory surfaces", async () => {
  const vdp = await source("app/lib/vdp.ts");

  assert.match(vdp, /function readerUrls\(targetUrl: URL\)/);
  assert.match(vdp, /hrefWithoutProtocol/);
  assert.match(vdp, /originPath/);
  assert.match(vdp, /r\.jina\.ai\/http:\/\/r\.jina\.ai\/http:\/\//);
  assert.match(vdp, /r\.jina\.ai\/http:\/\/\$\{hrefWithoutProtocol\}/);
  assert.match(vdp, /r\.jina\.ai\/http:\/\/\$\{originPath\}/);
});
