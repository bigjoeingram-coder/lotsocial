import assert from "node:assert/strict";
import test from "node:test";
import {
  handleCreativeRenderGet,
  handleCreativeRenderPost,
  requiresRegeneration,
} from "../app/lib/creative-render-handler.ts";
import { json, signedInUser, testEnv } from "./harness.mjs";

const cleanProject = {
  id: "project_1",
  vehicle_id: "veh_1",
  associate_email: "joe@example.com",
  selected_images: "[]",
  style: "walkaround",
  duration_seconds: 30,
  voiceover_script: "Clean script.",
  social_caption: "Clean caption.",
  end_card_name: "Joe",
  end_card_phone: "",
  end_card_email: "joe@example.com",
  end_card_cta: "Message me for details",
  status: "storyboard_ready",
  created_at: "2026-08-29 00:00:00",
  updated_at: "2026-08-29 00:00:00",
};

test("render revalidation blocks drafts created before the current copy policy", async () => {
  const staleProject = { ...cleanProject, created_at: "2026-08-19 23:59:59" };
  let touchedRenderer = false;

  const response = await handleCreativeRenderPost(
    new Request("https://app.example/api/creative-projects/project_1/render", { method: "POST" }),
    testEnv(),
    { params: Promise.resolve({ id: "project_1" }) },
    {
      associate: signedInUser,
      getCreativeProject: async () => staleProject,
      getLatestRenderJob: async () => {
        touchedRenderer = true;
        return null;
      },
    },
  );

  assert.equal(response.status, 409);
  assert.equal(touchedRenderer, false);
  assert.match((await json(response)).error, /Regenerate the creative draft/);
});

test("render status returns regenerationRequired for unsafe stored copy", async () => {
  const unsafeProject = { ...cleanProject, social_caption: "scrapeSource: diagnostic" };

  const response = await handleCreativeRenderGet(
    new Request("https://app.example/api/creative-projects/project_1/render"),
    testEnv(),
    { params: Promise.resolve({ id: "project_1" }) },
    {
      associate: signedInUser,
      getCreativeProject: async () => unsafeProject,
    },
  );

  assert.equal(response.status, 409);
  assert.deepEqual(await json(response), {
    error: "This saved draft predates the current LotSocial safety rules. Regenerate it before continuing.",
    regenerationRequired: true,
  });
});

test("render revalidation allows current clean copy", () => {
  assert.equal(requiresRegeneration(cleanProject), false);
});
