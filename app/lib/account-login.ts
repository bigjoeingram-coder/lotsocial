import { CONSUMER_EMAIL_DOMAINS, createAccountLoginLink, normalizeWorkEmail } from "./account-auth.ts";
import { sendAccountAccessEmail } from "./account-email.ts";
import type { AccountAccessEmail } from "./account-auth.ts";
import type { LotSocialEnvironment } from "./schema-bootstrap.ts";

export const LOGIN_GENERIC_MESSAGE = "If that work email has an active LotSocial account, a secure sign-in link is on the way.";
export const LOGIN_PERSONAL_EMAIL_MESSAGE = "Use your dealership work email. Personal emails like Gmail can't be used with LotSocial.";

type AccountLoginDependencies = {
  createLoginLink: (email: string, env: LotSocialEnvironment) => Promise<Omit<AccountAccessEmail, "kind"> | null>;
  sendAccessEmail: (email: AccountAccessEmail, env: LotSocialEnvironment) => Promise<boolean>;
};

const defaultDependencies: AccountLoginDependencies = {
  createLoginLink: createAccountLoginLink,
  sendAccessEmail: sendAccountAccessEmail,
};

export async function requestAccountLogin(
  emailValue: string,
  env: LotSocialEnvironment,
  dependencies: AccountLoginDependencies = defaultDependencies,
) {
  const email = normalizeWorkEmail(emailValue);
  const emailDomain = email.split("@").at(-1) ?? "";
  if (CONSUMER_EMAIL_DOMAINS.has(emailDomain)) {
    return { status: 400, body: { error: LOGIN_PERSONAL_EMAIL_MESSAGE } } as const;
  }

  const link = await dependencies.createLoginLink(email, env);
  if (link) {
    try {
      await dependencies.sendAccessEmail({ kind: "login", ...link }, env);
    } catch {
      // Keep the public response generic so account existence and delivery failures are not exposed.
    }
  }

  return { status: 200, body: { message: LOGIN_GENERIC_MESSAGE } } as const;
}
