export type AccountLoginNotice = {
  message: string;
  className: "account-message" | "account-message error";
  role: "status" | "alert";
};

export function accountLoginNotice(
  responseOk: boolean,
  payload: { message?: string; error?: string },
): AccountLoginNotice {
  const message = payload.error ?? payload.message;
  const isError = !responseOk || Boolean(payload.error) || !message;
  return {
    message: message ?? "Unable to request a sign-in link.",
    className: isError ? "account-message error" : "account-message",
    role: isError ? "alert" : "status",
  };
}
