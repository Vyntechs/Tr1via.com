// Plain-English messages + Supabase error classification for host sign-in.
// Hosts are not technical: every error they can see is written here.

// Every "start again" message names the real link on the page:
// "Use a different email" (shown on every step after the email box).
export const NO_PASSWORD_MESSAGE =
  "This account doesn't have a password yet. Tap \"Use a different email\", type your email again, and we'll email you a code to sign in.";
export const WRONG_PASSWORD_MESSAGE =
  "That password doesn't match this email. Please try again.";
export const NO_ACCOUNT_MESSAGE =
  "We don't have an account for that email. Tap \"Use a different email\" to check it for typos, or to create a new account.";
export const ACCOUNT_EXISTS_MESSAGE =
  "You already have an account with that email. Sign in with your password instead.";
export const RATE_LIMIT_MESSAGE =
  "Too many tries in a row. Please wait a minute, then try again.";
export const WEAK_PASSWORD_MESSAGE =
  "That password is too easy to guess. Please pick a longer one.";
export const TRY_AGAIN_MESSAGE =
  "Something went wrong on our end. Please try again in a minute.";
export const CODE_NOT_SENT_MESSAGE =
  "We couldn't send the code. Text Brandon for a sign-in link.";
export const TOO_MANY_CODES_MESSAGE =
  "We've already sent several codes to this email. Use the newest one, or wait an hour and try again. Text Brandon if you're stuck.";
export const WRONG_CODE_MESSAGE =
  "That code doesn't match. Check the newest email from TR1VIA and try again.";
export const CODE_EXPIRED_MESSAGE =
  "That code has run out of time. Tap \"Send a new code\" and use the new one.";
export const CODE_LOCKED_MESSAGE =
  "Too many wrong tries for that code. Tap \"Send a new code\" to get a fresh one.";
export const CODE_USED_MESSAGE =
  "That code was already used or replaced by a newer one. Tap \"Send a new code\".";
export const BAD_CODE_MESSAGE = "Please type the 6 numbers from the email.";
export const BAD_EMAIL_MESSAGE = "Please type a real email address.";
export const START_OVER_MESSAGE =
  "Let's start this sign-in over. Tap \"Use a different email\", then type your email again.";
export const HAS_PASSWORD_MESSAGE =
  "This account already has a password. Tap \"Use a different email\", type your email again, and sign in with your password. Forgot it? Tap \"Forgot password?\" on the next screen.";
export const TOO_MANY_TRIES_MESSAGE =
  "Too many tries. Wait 15 minutes, then try again. Text Brandon if you're stuck.";
export const LOCKED_OUT_MESSAGE = "Too many tries. Wait 15 minutes or use Forgot password.";
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
