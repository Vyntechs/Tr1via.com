// Plain-English messages + Supabase error classification for host sign-in.
// Hosts are not technical: every error they can see is written here.

export const NO_PASSWORD_MESSAGE =
  "This account doesn't have a password yet. Text Brandon for a sign-in link.";
export const WRONG_PASSWORD_MESSAGE =
  "That password doesn't match this email. Please try again.";
export const NO_ACCOUNT_MESSAGE =
  "We don't have an account for that email yet. Type your password again below to create one.";
export const ACCOUNT_EXISTS_MESSAGE =
  "You already have an account with that email. Sign in with your password instead.";
export const RATE_LIMIT_MESSAGE =
  "Too many tries in a row. Please wait a minute, then try again.";
export const WEAK_PASSWORD_MESSAGE =
  "That password is too easy to guess. Please pick a longer one.";
export const TRY_AGAIN_MESSAGE =
  "Something went wrong on our end. Please try again in a minute.";
export const SIGNED_OUT_MESSAGE =
  "You've been signed out. Please sign in again, then come back here.";

interface AuthErrorLike {
  status?: number;
  code?: string;
  message?: string;
}

function asAuthError(err: unknown): AuthErrorLike {
  return err && typeof err === "object" ? (err as AuthErrorLike) : {};
}

export function isRateLimited(err: unknown): boolean {
  const e = asAuthError(err);
  return e.status === 429 || (typeof e.code === "string" && e.code.startsWith("over_"));
}

export function isWeakPassword(err: unknown): boolean {
  return asAuthError(err).code === "weak_password";
}

export function isDuplicateEmail(err: unknown): boolean {
  const e = asAuthError(err);
  if (e.code === "email_exists" || e.code === "user_already_exists") return true;
  return /already (been )?registered|already exists/i.test(e.message ?? "");
}
