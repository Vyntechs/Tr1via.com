// @vitest-environment node

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";

const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../supabase/migrations",
);
const CLOCK_FILE = "20261104120000_live_clock_db_close.sql";

describe("database clock: close_due_questions and claim_close_broadcasts", () => {
  let db: PGlite;
  let categoryId: string;
  let gameId: string;
  let nightId: string;

  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`
      create schema if not exists extensions;
      create schema if not exists auth;
      create table if not exists auth.users (id uuid primary key default gen_random_uuid());
      create or replace function auth.uid() returns uuid language sql stable as 'select null::uuid';
      create role anon nologin;
      create role authenticated nologin;
      create role service_role nologin bypassrls;
    `);
    // The full chain needs Supabase's storage schema, which pglite doesn't have.
    // The real resolve_question body runs in the rig check (dbclock/test-c2.mjs).
    for (const file of [
      "0001_init.sql",
      "0002_rls.sql",
      "0021_live_security_gate.sql",
      "20260902225149_resolve_question_once.sql",
    ]) {
      await db.exec(readFileSync(path.join(MIGRATIONS_DIR, file), "utf8"));
    }
    await db.exec("alter table nights add column answer_engine text not null default 'legacy'");
    await db.exec(readFileSync(path.join(MIGRATIONS_DIR, CLOCK_FILE), "utf8"));
    const user = await db.query<{ id: string }>(
      "insert into auth.users default values returning id",
    );
    const host = await db.query<{ id: string }>(
      "insert into hosts (user_id, display_name) values ($1, 'Host') returning id",
      [user.rows[0].id],
    );
    const night = await db.query<{ id: string }>(
      "insert into nights (host_id, venue_name, room_code) values ($1, 'Venue', 'CLOCK1') returning id",
      [host.rows[0].id],
    );
    nightId = night.rows[0].id;
    const game = await db.query<{ id: string }>(
      "insert into games (night_id, game_no, state) values ($1, 1, 'live') returning id",
      [nightId],
    );
    gameId = game.rows[0].id;
    const category = await db.query<{ id: string }>(
      "insert into categories (game_id, name, topic, position) values ($1, 'Clock', 'Clock', 0) returning id",
      [gameId],
    );
    categoryId = category.rows[0].id;
  });

  afterAll(async () => {
    await db?.close();
  });

  beforeEach(async () => {
    await db.exec(`
      update live_clock set mode = 'on', only_night_id = null, grace_ms = 1000;
      delete from question_close_events;
      update questions set finished_at = now() where finished_at is null;
    `);
    await db.query("update games set state = 'live' where id = $1", [gameId]);
  });

  async function question(ageSeconds: number, finished = false) {
    const result = await db.query<{ id: string }>(
      `insert into questions (
         category_id, prompt, options, correct_index, played_at, finished_at
       ) values (
         $1, 'Prompt?', '["A","B","C","D"]'::jsonb, 2,
         now() - make_interval(secs => $2), case when $3 then now() end
       ) returning id`,
      [categoryId, ageSeconds, finished],
    );
    return result.rows[0].id;
  }
  const sweep = async () =>
    (await db.query<{ n: number }>("select public.close_due_questions() n")).rows[0].n;
  const claim = async () =>
    (await db.query<{ question_id: string; correct_index: number; room_code: string }>(
      "select * from public.claim_close_broadcasts()",
    )).rows;
  const finished = async (id: string) =>
    (await db.query<{ finished_at: string | null }>(
      "select finished_at from questions where id = $1",
      [id],
    )).rows[0].finished_at !== null;
  const events = async (id: string) =>
    (await db.query<{
      shadow: boolean;
      played_at: Date;
      commit_at: Date | null;
      closed_at: Date;
      dropped_at: Date | null;
      drop_reason: string | null;
    }>("select * from question_close_events where question_id = $1", [id])).rows;

  test("stops when the question isn't overdue: 25s plus the 1s grace", async () => {
    const early = await question(25.5);
    expect(await sweep()).toBe(0);
    expect(await finished(early)).toBe(false);
    expect(await events(early)).toEqual([]);

    const due = await question(26.1);
    expect(await sweep()).toBe(1);
    expect(await finished(due)).toBe(true);
    expect(await finished(early)).toBe(false);
  });

  test("grace_ms moves the line", async () => {
    await db.exec("update live_clock set grace_ms = 3000");
    const id = await question(26.1);
    expect(await sweep()).toBe(0);
    expect(await finished(id)).toBe(false);
  });

  test("closes timers only: everyone answering doesn't close it", async () => {
    const id = await question(3);
    const player = await db.query<{ id: string }>(
      "insert into players (night_id, device_id, display_name) values ($1, gen_random_uuid(), 'P') returning id",
      [nightId],
    );
    await db.query(
      "insert into game_participations (game_id, player_id) values ($1, $2)",
      [gameId, player.rows[0].id],
    );
    await db.query(
      `insert into answers (question_id, player_id, chosen_index, scramble, ms_to_lock, locked_at)
       values ($1, $2, 0, '[0,1,2,3]'::jsonb, 1000, now() - interval '2 seconds')`,
      [id, player.rows[0].id],
    );
    expect(await sweep()).toBe(0);
    expect(await finished(id)).toBe(false);
  });

  test("stops on a stale played_at: over 10 minutes old stays open", async () => {
    const id = await question(601);
    expect(await sweep()).toBe(0);
    expect(await finished(id)).toBe(false);
  });

  test("stops when the question is already finished", async () => {
    const id = await question(30, true);
    expect(await sweep()).toBe(0);
    expect(await events(id)).toEqual([]);
  });

  test("stops when the game isn't live", async () => {
    const id = await question(30);
    await db.query("update games set state = 'done' where id = $1", [gameId]);
    expect(await sweep()).toBe(0);
    expect(await finished(id)).toBe(false);
  });

  test("one winner: one row, one claim, and the route then loses", async () => {
    const id = await question(30);
    expect(await sweep()).toBe(1);
    expect(await sweep()).toBe(0);
    const rows = await events(id);
    expect(rows).toHaveLength(1);
    expect(rows[0].commit_at).not.toBeNull();
    expect(rows[0].commit_at!.getTime()).toBeGreaterThanOrEqual(rows[0].closed_at.getTime());

    const once = await db.query<{ won: boolean }>(
      "select public.resolve_question_once($1) won",
      [id],
    );
    expect(once.rows[0].won).toBe(false);

    const claimed = await claim();
    expect(claimed.map((r) => r.question_id)).toEqual([id]);
    expect(claimed[0]).toMatchObject({ correct_index: 2, room_code: "CLOCK1" });
    expect(await claim()).toEqual([]);
  });

  test("a route close leaves nothing for the outbox", async () => {
    const id = await question(30);
    await db.query("select public.resolve_question_once($1)", [id]);
    expect(await sweep()).toBe(0);
    expect(await events(id)).toEqual([]);
    expect(await claim()).toEqual([]);
  });

  test("off closes nothing; shadow logs once and can't be claimed", async () => {
    const id = await question(30);
    await db.exec("update live_clock set mode = 'off'");
    expect(await sweep()).toBe(0);
    expect(await events(id)).toEqual([]);

    await db.exec("update live_clock set mode = 'shadow'");
    await sweep();
    await sweep();
    const rows = await events(id);
    expect(rows).toHaveLength(1);
    expect(rows[0].shadow).toBe(true);
    expect(await finished(id)).toBe(false);
    expect(await claim()).toEqual([]);

    await db.exec("update live_clock set mode = 'on'");
    expect(await sweep()).toBe(1);
    expect(await finished(id)).toBe(true);
  });

  test("only_night_id limits the sweep to that night", async () => {
    const id = await question(30);
    await db.query("update live_clock set only_night_id = gen_random_uuid()");
    expect(await sweep()).toBe(0);
    await db.query("update live_clock set only_night_id = $1", [nightId]);
    expect(await sweep()).toBe(1);
    expect(await finished(id)).toBe(true);
  });

  test("a close undone or reset afterwards is dropped, not announced", async () => {
    const reset = await question(30);
    const replayed = await question(31);
    await sweep();
    await db.query("update questions set finished_at = null, played_at = null where id = $1", [reset]);
    await db.query("update questions set played_at = now() where id = $1", [replayed]);

    expect(await claim()).toEqual([]);
    expect((await events(reset))[0].drop_reason).toBe("question_changed");
    expect((await events(replayed))[0].drop_reason).toBe("question_changed");
  });

  test("time budget: past 60s is given up, 3 per claim, 3s lease", async () => {
    const ids = [await question(30), await question(31), await question(32), await question(33)];
    await sweep();
    await db.query("update question_close_events set closed_at = now() - interval '61 seconds' where question_id = $1", [ids[3]]);

    expect((await claim()).map((r) => r.question_id).sort()).toEqual(ids.slice(0, 3).sort());
    expect((await events(ids[3]))[0].drop_reason).toBe("expired");
    expect(await claim()).toEqual([]);

    await db.exec(`
      update question_close_events set sent_at = null, sent_via = null
       where dropped_at is null;
      update question_close_events set claimed_at = claimed_at - interval '3 seconds';
    `);
    expect(await claim()).toHaveLength(3);
  });

  test("the claim is the sent mark: a claimed row never comes back on its own", async () => {
    const id = await question(30);
    await sweep();
    expect(await claim()).toHaveLength(1);
    const [claimed] = (await db.query<{ sent_at: Date | null; sent_via: string | null }>(
      "select sent_at, sent_via from question_close_events where question_id = $1",
      [id],
    )).rows;
    expect(claimed.sent_at).not.toBeNull();
    expect(claimed.sent_via).toBe("claimed");

    await db.exec("update question_close_events set claimed_at = claimed_at - interval '30 seconds'");
    expect(await claim()).toEqual([]);
  });

  test("a released row waits out the lease, then goes round again", async () => {
    const id = await question(30);
    await sweep();
    await claim();
    const release = "update question_close_events set sent_at = null, sent_via = null";

    await db.exec(release);
    expect(await claim()).toEqual([]);

    await db.exec("update question_close_events set claimed_at = claimed_at - interval '3 seconds'");
    expect((await claim()).map((r) => r.question_id)).toEqual([id]);
  });

  test("a released row still expires at the 60-second budget", async () => {
    const id = await question(30);
    await sweep();
    await claim();
    await db.exec(`
      update question_close_events set sent_at = null, sent_via = null,
        claimed_at = claimed_at - interval '3 seconds',
        closed_at = now() - interval '61 seconds';
    `);

    expect(await claim()).toEqual([]);
    expect((await events(id))[0].drop_reason).toBe("expired");
  });

  describe("schedule and pre-show check", () => {
    const check = async () =>
      (await db.query<{ r: { ok: boolean; problems: string[] } }>(
        "select public.live_clock_preshow_check() r",
      )).rows[0].r;

    beforeAll(async () => {
      await db.exec(`
        create schema cron;
        create table cron.job (jobid bigserial primary key, jobname text unique, schedule text, command text, active boolean default true);
        create function cron.schedule(n text, s text, c text) returns bigint language sql as
          $$ insert into cron.job (jobname, schedule, command) values (n, s, c)
             on conflict (jobname) do update set schedule = excluded.schedule returning jobid $$;
        create function cron.alter_job(job_id bigint, active boolean) returns void language sql as
          $$ update cron.job set active = alter_job.active where jobid = job_id $$;
      `);
      await db.exec(readFileSync(path.join(MIGRATIONS_DIR, CLOCK_FILE), "utf8"));
    });

    test("the check names every problem, and passes when ticking and clean", async () => {
      const id = await question(30);
      await sweep();
      await db.exec(`
        update live_clock set last_tick_at = now() - interval '1 minute', mode = 'shadow',
          only_night_id = gen_random_uuid();
      `);
      const bad = await check();
      expect(bad.ok).toBe(false);
      expect(bad.problems).toEqual([
        "mode is shadow, expected on",
        "only_night_id is set",
        "job is not ticking",
        "1 unsent close rows",
      ]);

      await db.query("update question_close_events set sent_at = now() where question_id = $1", [id]);
      await db.exec("update live_clock set mode = 'on', only_night_id = null");
      await sweep();
      expect(await check()).toMatchObject({ ok: true, problems: [] });
    });

    test("with no live game, the gate's run counts as ticking", async () => {
      await db.query("update games set state = 'done' where id = $1", [gameId]);
      await db.exec("update live_clock set last_tick_at = null, last_gate_at = null");
      expect((await check()).problems).toEqual(["job is not ticking"]);
      await db.query("select public.live_clock_cron_gate()");
      expect((await check()).ok).toBe(true);
    });

    test("with no live game, a recent gate run can't hide a missing job", async () => {
      await db.query("update games set state = 'done' where id = $1", [gameId]);
      await db.exec(`
        create table cron.job_kept as select * from cron.job;
        delete from cron.job where jobname = 'tr1via-close-due';
      `);
      const warnings: string[] = [];
      await db.query("select public.live_clock_cron_gate()", [], {
        onNotice: (notice) => void warnings.push(notice.message ?? ""),
      });
      expect(warnings).toEqual(["live_clock_cron_gate: job tr1via-close-due is not scheduled"]);
      expect(await check()).toMatchObject({
        ok: false,
        problems: ["job tr1via-close-due is not scheduled"],
      });

      await db.exec("delete from cron.job");
      await db.query("select public.live_clock_cron_gate()");
      expect((await check()).problems).toEqual([
        "job tr1via-close-due is not scheduled",
        "job tr1via-close-due-gate is not scheduled",
        "job tr1via-cron-history-trim is not scheduled",
      ]);

      await db.exec(`
        insert into cron.job select * from cron.job_kept
          where jobname not in (select jobname from cron.job);
        drop table cron.job_kept;
      `);
      await db.query("select public.live_clock_cron_gate()");
      expect((await check()).ok).toBe(true);
    });

    test("a database without pg_cron fails the check", async () => {
      await db.query("update games set state = 'done' where id = $1", [gameId]);
      await db.exec("alter schema cron rename to cron_away");
      await db.query("select public.live_clock_cron_gate()");
      expect((await check()).problems).toEqual(["pg_cron is not installed"]);
      await db.exec("alter schema cron_away rename to cron");
    });

    test("with a stand-in pg_cron: schedules three jobs, the gate follows live games", async () => {
      await db.exec(readFileSync(path.join(MIGRATIONS_DIR, CLOCK_FILE), "utf8"));
      const jobs = async () =>
        (await db.query<{ jobname: string; schedule: string; active: boolean }>(
          "select jobname, schedule, active from cron.job order by jobname",
        )).rows;
      expect((await jobs()).map((j) => j.jobname)).toEqual([
        "tr1via-close-due",
        "tr1via-close-due-gate",
        "tr1via-cron-history-trim",
      ]);
      expect((await jobs())[0]).toMatchObject({ schedule: "1 second", active: false });

      await db.query("select public.live_clock_cron_gate()");
      expect((await jobs())[0].active).toBe(true);
      await db.query("update games set state = 'done' where id = $1", [gameId]);
      await db.query("select public.live_clock_cron_gate()");
      expect((await jobs())[0].active).toBe(false);

      await db.query("update games set state = 'live' where id = $1", [gameId]);
      await db.exec("update live_clock set mode = 'off'");
      await db.query("select public.live_clock_cron_gate()");
      expect((await jobs())[0].active).toBe(false);
    });
  });
});
