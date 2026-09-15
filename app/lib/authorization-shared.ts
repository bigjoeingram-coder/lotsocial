export const PERMISSIONS = [
  { id: "vehicle_facts", tier: "manager", label: "Vehicle facts & availability", detail: "VIN, stock number, specifications and inventory status" },
  { id: "pricing", tier: "manager", label: "Pricing & incentives", detail: "Dealer-approved prices, fees and eligibility-qualified incentives" },
  { id: "images", tier: "provider", label: "Vehicle images", detail: "Only images the dealership or provider is authorized to license" },
  { id: "descriptions", tier: "provider", label: "Descriptions & feature copy", detail: "Dealer or OEM copy where reuse rights are confirmed" },
  { id: "window_stickers", tier: "provider", label: "Window stickers", detail: "Sticker data and links where redistribution is permitted" },
  { id: "social_publishing", tier: "manager", label: "Social publishing", detail: "Use approved content in associate-created social posts" },
] as const;

export type PermissionId = (typeof PERMISSIONS)[number]["id"];
export type PermissionTier = (typeof PERMISSIONS)[number]["tier"];
