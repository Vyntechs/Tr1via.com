// The steps of the pre-show check, kept apart from the database call so they can
// be tested. See scripts/live-clock-preshow.mjs.

export const POLL_MS = 10_000;
// The gate runs once a minute, so the sweep can start up to a minute after a game
// goes live. This waits that out before calling the tick a failure.
export const TICK_WAIT_MS = 90_000;
export const LIVE_WAIT_MS = 2 * 60 * 60 * 1000;

const isLive = (result) => result.liveGames > 0;

function finish(result, log) {
  if (!result.ok) {
    log(`FAIL ${result.problems.join("; ")}`);
    return 1;
  }
  const proof = isLive(result)
    ? `last tick ${result.lastTickAt ?? "none"}`
    : "tick not proven until a game is live, check again then";
  log(`PASS mode ${result.mode}, ${result.liveGames} live games, ${proof}`);
  return 0;
}

/** Returns the exit code. `check` must resolve, even when the call failed. */
export async function runPreshow({ check, sleep, now, log, once = false }) {
  let result = await check();
  if (once || (!result.ok && !isLive(result))) return finish(result, log);

  if (!isLive(result)) {
    log("WAIT jobs are set, staying on to check the tick once a game goes live");
    const giveUpAt = now() + LIVE_WAIT_MS;
    while (!isLive(result)) {
      if (now() >= giveUpAt) {
        log("FAIL no game went live, so the tick was never proven");
        return 1;
      }
      await sleep(POLL_MS);
      result = await check();
    }
  }

  const tickBy = now() + TICK_WAIT_MS;
  while (!result.ok && now() < tickBy) {
    await sleep(POLL_MS);
    result = await check();
  }
  return finish(result, log);
}
