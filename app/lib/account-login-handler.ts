import { normalizeWorkEmail } from "./account-auth.ts";
import { LOGIN_GENERIC_MESSAGE, requestAccountLogin } from "./account-login.ts";
import { incrementDailyLimit } from "./limits.ts";
import type { LotSocialEnvironment } from "./schema-bootstrap.ts";

const LOGIN_EMAIL_WINDOW_MS = 15 * 60 * 1000;

type AccountLoginHandlerDependencies = {
  incrementLimit?: typeof incrementDailyLimit;
  requestLogin?: typeof requestAccountLogin;
  now?: () => Date;
};

function requestIp(request: Request) {
  return request.headers.get("cf-connecting-ip")
    || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || "unknown";
}

function emailWindowSubject(email: string, now: Date) {
  return `${email}:${Math.floor(now.getTime() / LOGIN_EMAIL_WINDOW_MS)}`;
}

export async function handleAccountLoginPost(
  request: Request,
  env: LotSocialEnvironment,
  dependencies: AccountLoginHandlerDependencies = {},
) {
  const payload = await request.json().catch(() => ({})) as { email?: unknown };
  const emailValue = typeof payload.email === "string" ? payload.email : "";
  const email = normalizeWorkEmail(emailValue);
  const now = dependencies.now?.() ?? new Date();
  const consumeLimit = dependencies.incrementLimit ?? incrementDailyLimit;
  const checks = [consumeLimit(env, "account_login_ip", requestIp(request), now)];
  if (email) checks.push(consumeLimit(env, "account_login_email", emailWindowSubject(email, now), now));

  const limits = await Promise.all(checks);
  if (limits.some((limit) => !limit.allowed)) {
    return Response.json({ message: LOGIN_GENERIC_MESSAGE }, { status: 200 });
  }

  const result = await (dependencies.requestLogin ?? requestAccountLogin)(emailValue, env);
  return Response.json(result.body, { status: result.status });
}
