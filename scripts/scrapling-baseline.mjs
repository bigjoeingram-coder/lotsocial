import { readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { parseVehicleHtml } from "../app/lib/vdp.ts";

const [fixturePath, sourceUrl] = process.argv.slice(2);
if (!fixturePath || !sourceUrl) {
  console.error("usage: node scripts/scrapling-baseline.mjs FIXTURE SOURCE_URL");
  process.exit(64);
}

const html = await readFile(fixturePath, "utf8");
const started = performance.now();
try {
  const vehicle = await parseVehicleHtml(html, new URL(sourceUrl));
  console.log(JSON.stringify({ accepted: true, vehicle, latencyMs: performance.now() - started }));
} catch (error) {
  console.log(JSON.stringify({ accepted: false, error: error instanceof Error ? error.message : "rejected", latencyMs: performance.now() - started }));
}
