import type { PostingDeps } from "./engine.ts";
import { dispatchSlot, dueSlotIds } from "./dispatcher.ts";
import type { DispatchResult } from "./dispatcher.ts";
import { reconcile } from "./reconciler.ts";
import type { ReconcileSummary } from "./reconciler.ts";

export type TickSummary = { reconcile: ReconcileSummary; dispatched: DispatchResult[] };

// One pass of the engine: settle what is already in motion, then send what is due.
// Nothing calls this on a timer yet. The caller is a deploy decision.
export async function runPostingTick(deps: PostingDeps): Promise<TickSummary> {
  const reconciled = await reconcile(deps);
  const dispatched: DispatchResult[] = [];
  for (const slotId of await dueSlotIds(deps)) {
    const result = await dispatchSlot(deps, slotId);
    if (result) dispatched.push(result);
  }
  return { reconcile: reconciled, dispatched };
}
