// Runs work after the reply has gone. A failure to schedule it, or a failure
// inside it, must never touch a request that already has its result. The
// answer is saved and the question is stamped by the time anything calls this.
//
// after() has no retry, and whether it finishes when the reply can't be
// delivered is unverified on Vercel. Nothing that must happen can rest on this
// alone.

import { after } from "next/server";

export function afterReply(work: () => Promise<unknown>): void {
  try {
    after(async () => {
      try {
        await work();
      } catch {
        console.warn("after-reply work failed");
      }
    });
  } catch {
    console.warn("after-reply work could not be scheduled");
  }
}
