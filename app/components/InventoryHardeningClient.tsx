"use client";

import { useEffect } from "react";

const HARDENING_MARKER = "data-lotsocial-hardening";
const UNSAFE_COPY_PATTERNS = [
  /scrapeSource/i,
  /<br\s*\/?\s*>/i,
  /(?:pre-owned|used)\s+cars\s+for\s+sale/i,
  /view\s+\d+\s+matches/i,
];

function isUnsafeCreative(output: Element) {
  const text = output.textContent ?? "";
  return UNSAFE_COPY_PATTERNS.some((pattern) => pattern.test(text));
}

function hardenCreativeOutput(output: Element) {
  const unsafe = isUnsafeCreative(output);
  output.toggleAttribute("data-regeneration-required", unsafe);
  if (!unsafe) return;

  output.querySelectorAll<HTMLButtonElement>(".output-grid button, .render-gate button").forEach((button) => {
    button.disabled = true;
    button.title = "This draft was generated before the current LotSocial safety rules. Regenerate it before copying or rendering.";
  });

  const heading = output.querySelector(".output-heading-actions");
  if (heading && !heading.querySelector("[data-stale-warning]")) {
    const warning = document.createElement("strong");
    warning.dataset.staleWarning = "true";
    warning.textContent = "Regeneration required";
    warning.style.cssText = "color:#a33b35;font-size:12px;font-weight:800";
    heading.prepend(warning);
  }
}

function installDeleteAction(card: Element) {
  if (card.getAttribute(HARDENING_MARKER) === "installed") return;
  const sourceLink = Array.from(card.querySelectorAll<HTMLAnchorElement>("a")).find((link) => /view source/i.test(link.textContent ?? ""));
  const body = card.querySelector(".vehicle-body");
  if (!sourceLink || !body) return;

  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "Delete vehicle";
  button.setAttribute("aria-label", "Delete this vehicle from My Inventory");
  button.style.cssText = "margin-top:10px;width:100%;min-height:38px;border:1px solid #e8c9c6;border-radius:10px;background:#fff;color:#a33b35;font-weight:750;font-size:12px";

  button.addEventListener("click", async () => {
    if (!window.confirm("Delete this vehicle and its saved LotSocial drafts? This cannot be undone.")) return;
    button.disabled = true;
    button.textContent = "Deleting...";
    try {
      const response = await fetch("/api/vdp-imports/delete", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceUrl: sourceLink.href }),
      });
      const payload = await response.json() as { deleted?: boolean; error?: string };
      if (!response.ok || !payload.deleted) throw new Error(payload.error ?? "Vehicle deletion failed.");
      window.location.reload();
    } catch (error) {
      button.disabled = false;
      button.textContent = "Delete vehicle";
      window.alert(error instanceof Error ? error.message : "Vehicle deletion failed.");
    }
  });

  body.appendChild(button);
  card.setAttribute(HARDENING_MARKER, "installed");
}

export function InventoryHardeningClient() {
  useEffect(() => {
    const harden = () => {
      document.querySelectorAll(".vehicle-card").forEach(installDeleteAction);
      document.querySelectorAll(".creative-output").forEach(hardenCreativeOutput);
    };

    harden();
    const observer = new MutationObserver(harden);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, []);

  return null;
}
