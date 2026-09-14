import { env } from "cloudflare:workers";
import { requireChatGPTUser } from "./chatgpt-auth";
import { AuthorizationApp } from "./components/AuthorizationApp";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await requireChatGPTUser("/", env);
  return <AuthorizationApp user={{
    name: user.displayName,
    email: user.email,
    phone: user.phone,
    dealershipName: user.dealershipName,
    rooftopLocation: user.rooftopLocation,
    profilePhotoUrl: user.profilePhotoUrl,
  }} />;
}
