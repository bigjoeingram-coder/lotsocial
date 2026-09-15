import { env } from "cloudflare:workers";
import { requireChatGPTUser } from "./chatgpt-auth";
import { AuthorizationApp } from "./components/AuthorizationApp";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await requireChatGPTUser("/", env);
  const renderConfig = `v82:${env.LOTSOCIAL_RENDER_PROXY_ORIGIN?.trim() ? "origin" : "no-origin"}:${env.LOTSOCIAL_RENDER_PROXY_SECRET?.trim() ? "secret" : "no-secret"}`;
  return <>
    <span hidden data-render-config={renderConfig} />
    <AuthorizationApp user={{
      name: user.displayName,
      email: user.email,
      phone: user.phone,
      dealershipName: user.dealershipName,
      rooftopLocation: user.rooftopLocation,
      profilePhotoUrl: user.profilePhotoUrl,
    }} />
  </>;
}
