// "What's new" pop-up content (components/host/HostWhatsNew.tsx).
//
// Keep ONE current entry in HOST_NEWS. When there's news, replace it with a
// new `id` and `date`: the old entry's "seen" mark then no longer matches,
// and the pop-up can never show old news because the dashboard only opens
// it by itself for AUTO_SHOW_DAYS after `date`.

export interface WhatsNewStep {
  title: string;
  body: string;
}

export interface WhatsNewContent {
  /** Unique per announcement — the "seen" mark is keyed on it. */
  id: string;
  /** YYYY-MM-DD the news shipped. */
  date: string;
  eyebrow: string;
  title: string;
  lead: string;
  steps: readonly WhatsNewStep[];
  footer?: string;
  button: string;
  /** Open by itself on the host dashboard (still limited to AUTO_SHOW_DAYS). */
  autoShow: boolean;
}

export const AUTO_SHOW_DAYS = 30;

// Shown on the sign-in page right after a host with no password yet types
// her email and the server has emailed her a code (app/(host)/login).
export const SIGN_IN_PASSWORD_NEWS: WhatsNewContent = {
  id: "2026-09-passwords-sign-in",
  date: "2026-09-27",
  eyebrow: "What's new · Signing in",
  title: "TR1VIA now uses a password.",
  lead: "It keeps your trivia nights safe, so only you can open them. Running your night hasn't changed at all.",
  steps: [
    {
      title: "Check your email.",
      body: "We just sent you a 6-digit code from TR1VIA. Check your spam folder if you don't see it. Type it on the next screen.",
    },
    {
      title: "Create your password.",
      body: "Pick one you'll remember. You only do this once.",
    },
    {
      title: "That's it.",
      body: "From then on, sign in with your email and password. No more codes.",
    },
  ],
  footer: "Stuck? Text Brandon.",
  button: "Got it  →",
  autoShow: false,
};

// The dashboard's "What's new" button. Doesn't open by itself: hosts
// already see the sign-in version when it matters.
export const HOST_NEWS: WhatsNewContent = {
  id: "2026-09-passwords",
  date: "2026-09-27",
  eyebrow: "What's new · Signing in",
  title: "TR1VIA now uses a password.",
  lead: "It keeps your trivia nights safe, so only you can open them. Running your night hasn't changed at all.",
  steps: [
    {
      title: "Check your email.",
      body: "The first time you sign in, we send you a 6-digit code from TR1VIA. Check your spam folder if you don't see it.",
    },
    {
      title: "Create your password.",
      body: "Pick one you'll remember. You only do this once.",
    },
    {
      title: "That's it.",
      body: "From then on, sign in with your email and password. No more codes.",
    },
  ],
  footer: "Stuck? Text Brandon.",
  button: "Got it",
  autoShow: false,
};

export function whatsNewSeenKey(news: Pick<WhatsNewContent, "id">): string {
  return `tr1via-whats-new-seen:${news.id}`;
}

/** Open by itself only while the news is fresh and she hasn't closed it. */
export function shouldAutoShowWhatsNew(
  news: Pick<WhatsNewContent, "date" | "autoShow">,
  seen: boolean,
  now: Date = new Date(),
): boolean {
  if (!news.autoShow || seen) return false;
  const shipped = Date.parse(`${news.date}T00:00:00Z`);
  if (Number.isNaN(shipped)) return false;
  const ageDays = (now.getTime() - shipped) / 86_400_000;
  return ageDays >= 0 && ageDays <= AUTO_SHOW_DAYS;
}
