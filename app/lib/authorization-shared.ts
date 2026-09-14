export type PermissionAuthority = "manager" | "provider";

export const PERMISSIONS = [
  { id: "vehicle_facts", label: "Vehicle facts & availability", detail: "VIN, stock number, specifications and inventory status", authority: "manager" },
  { id: "pricing", label: "Pricing & incentives", detail: "Dealer-approved prices, fees and eligibility-qualified incentives", authority: "manager" },
  { id: "images", label: "Vehicle images", detail: "Only images the dealership or provider is authorized to license", authority: "provider" },
  { id: "descriptions", label: "Descriptions & feature copy", detail: "Dealer or OEM copy where reuse rights are confirmed", authority: "provider" },
  { id: "window_stickers", label: "Window stickers", detail: "Sticker data and links where redistribution is permitted", authority: "provider" },
  { id: "social_publishing", label: "Social publishing", detail: "Use approved content in associate-created social posts", authority: "manager" },
] as const;

export type PermissionId = (typeof PERMISSIONS)[number]["id"];

export function permissionAuthority(permission: PermissionId): PermissionAuthority {
  return PERMISSIONS.find((item) => item.id === permission)?.authority ?? "provider";
}
