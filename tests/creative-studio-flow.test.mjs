import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../app/components/AuthorizationApp.tsx", import.meta.url), "utf8");

test("post draft action reveals copy and starts the video render from the saved project", () => {
  assert.match(source, /"Create post draft"/);
  assert.doesNotMatch(source, /"Generate creative draft"/);
  assert.match(
    source,
    /setCreativeDraft\(payload\.project\);\s*setRenderJob\(null\);\s*setGeneratingCreative\(false\);\s*if \(selectedCreativeImages\.length >= 2\) await startCreativeRender\(payload\.project\);/,
  );
});

test("caption-only drafts do not start a paid video render", () => {
  assert.match(source, /if \(selectedCreativeImages\.length >= 2\) await startCreativeRender/);
});
