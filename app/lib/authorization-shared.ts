export const PERMISSIONS = [
  { id: "vehicle_facts", label: "Vehicle facts & availability", detail: "VIN, stock number, specifications and inventory status" },
  { id: "pricing", label: "Pricing & incentives", detail: "Dealer-approved prices, fees and eligibility-qualified incentives" },
  { id: "images", label: "Vehicle images", detail: "Only images the dealership or provider is authorized to license" },
  { id: "descriptions", label: "Descriptions & feature copy", detail: "Dealer or OEM copy where reuse rights are confirmed" },
  { id: "window_stickers", label: "Window stickers", detail: "Sticker data and links where redistribution is permitted" },
  { id: "social_publishing", label: "Social publishing", detail: "Use approved content in associate-created social posts" },
] as const;

export type PermissionId = (typeof PERMISSIONS)[number]["id"];
