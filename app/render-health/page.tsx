import { env } from "cloudflare:workers";

export default function RenderHealthPage() {
  const origin = Boolean(env.LOTSOCIAL_RENDER_PROXY_ORIGIN?.trim());
  const secret = Boolean(env.LOTSOCIAL_RENDER_PROXY_SECRET?.trim());
  return <main><h1>LotSocial render health</h1><p data-version="v79">Proxy origin: {origin ? "configured" : "missing"}</p><p>Proxy secret: {secret ? "configured" : "missing"}</p></main>;
}
