function badHost(host) {
  const normalized = host.toLowerCase();
  if (normalized === "localhost" || normalized.endsWith(".local") || normalized.endsWith(".internal")) return true;
  const match = normalized.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!match) return false;
  const [a, b] = match.slice(1).map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

function base64Url(bytes) {
  let binary = "";
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decodeBase64Url(value) {
  const raw = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = raw + "=".repeat((4 - (raw.length % 4)) % 4);
  return new TextDecoder().decode(Uint8Array.from(atob(padded), (character) => character.charCodeAt(0)));
}

async function sign(secret, message) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return base64Url(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message)));
}

function sourceHeaders(upstream, source) {
  const headers = new Headers({
    "Cache-Control": "public, max-age=7200, immutable",
    "X-Content-Type-Options": "nosniff",
    "Access-Control-Allow-Origin": "*",
  });
  let type = (upstream.headers.get("content-type") || "").split(";")[0].toLowerCase();
  if (!type.startsWith("image/")) {
    const path = source.pathname.toLowerCase();
    type = path.endsWith(".png") ? "image/png" : path.endsWith(".webp") ? "image/webp" : path.endsWith(".avif") ? "image/avif" : "image/jpeg";
  }
  headers.set("Content-Type", type);
  const size = upstream.headers.get("content-length");
  if (size) headers.set("Content-Length", size);
  return headers;
}

const renderSourceWorker = {
  async fetch(request, env) {
    const requestUrl = new URL(request.url);
    if (!['GET', 'HEAD'].includes(request.method) || requestUrl.pathname !== "/image") return new Response("Not found", { status: 404 });

    const expires = requestUrl.searchParams.get("e") || "";
    const encodedSource = requestUrl.searchParams.get("u") || "";
    const signature = requestUrl.searchParams.get("s") || "";
    const expiry = Number(expires);
    const now = Math.floor(Date.now() / 1000);
    if (!Number.isFinite(expiry) || expiry < now || expiry > now + 7500) return new Response("Expired", { status: 403 });
    const expected = await sign(env.PROXY_SECRET, `${expires}.${encodedSource}`);
    if (signature.length !== expected.length || !signature.split("").every((character, index) => character === expected[index])) {
      return new Response("Forbidden", { status: 403 });
    }

    let source;
    try {
      source = new URL(decodeBase64Url(encodedSource));
    } catch {
      return new Response("Bad source", { status: 400 });
    }
    if (source.protocol !== "https:" || badHost(source.hostname)) return new Response("Bad source", { status: 400 });

    const cache = caches.default;
    const cacheKey = new Request(request.url, { method: "GET" });
    const cached = await cache.match(cacheKey);
    if (cached) {
      return request.method === "HEAD" ? new Response(null, { status: cached.status, headers: cached.headers }) : cached;
    }

    const upstream = await fetch(source.toString(), {
      headers: {
        Accept: "image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8",
        "User-Agent": "Mozilla/5.0 (compatible; LotSocialRender/1.1)",
      },
    });
    if (!upstream.ok) return new Response("Source unavailable", { status: 502 });
    const size = Number(upstream.headers.get("content-length") || 0);
    if (size > 15 * 1024 * 1024) return new Response("Source too large", { status: 413 });
    const headers = sourceHeaders(upstream, source);
    if (request.method === "HEAD") {
      await upstream.body?.cancel();
      return new Response(null, { status: 200, headers });
    }
    const response = new Response(upstream.body, { status: 200, headers });
    await cache.put(cacheKey, response.clone());
    return response;
  },
};

export default renderSourceWorker;
