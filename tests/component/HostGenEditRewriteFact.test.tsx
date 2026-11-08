// The question editor's fun-fact button, driven on the real pick screen.
//
// Reported 2026-11-07 (Heather, building a November game): she rewrote a
// Planes, Trains and Automobiles question into a Free Birds question, left
// answers 2 and 4 both "Win a cooking competition", and pressed "Rewrite to
// match" to replace the old movie's fun fact. That button saves first; the
// save was refused, so the fun fact stayed on the wrong movie and all she got
// was "options must be four distinct values" in a red box.
//
// Reproducing it turned up a second problem: the editor stayed editable while
// the button said "Rewriting…", and whatever she typed in those seconds was
// thrown away when the new fun fact arrived (the panel reloads from the saved
// question). The fake server below applies the save route's real schema.

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PatchQuestionBodySchema } from "@/lib/api/schemas";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/lib/hooks/useGenerationStatus", () => ({
  GENERATION_STALL_TIMEOUT_MS: 330_000,
  useGenerationStatus: () => ({ kind: "ok" }),
}));
vi.mock("@/lib/supabase/client", () => ({
  getSupabaseBrowser: () => ({
    channel: () => {
      const channel = { on: () => channel, subscribe: vi.fn() };
      return channel;
    },
    removeChannel: vi.fn(),
    from: () => {
      const result = Promise.resolve({ data: null, error: null });
      const chain: Record<string, unknown> = { then: result.then.bind(result) };
      for (const m of ["select", "eq", "in", "order", "limit", "maybeSingle", "single"]) chain[m] = () => chain;
      return chain;
    },
  }),
}));

import { HostSetupPickClient } from "@/app/host/setup/[nightId]/pick/[categoryId]/HostSetupPickClient";
type Row = Parameters<typeof HostSetupPickClient>[0]["initialQuestions"][number];

const PTA_FACT =
  "Neal and Del travel by plane, train, bus, taxi, semi-truck, and rental car — but never a subway. Their odyssey covers nearly every other form of transport imaginable.";

function ptaRow(): Row {
  return {
    id: "q1",
    category_id: "category-1",
    point_value: 200,
    prompt: "In Planes, Trains and Automobiles, where are Neal and Del trying to get to?",
    options: ["Chicago", "New York", "Wichita", "St. Louis"],
    correct_index: 0,
    image_url: null,
    image_attribution: null,
    image_source: null,
    difficulty: 2,
    source: "ai",
    is_picked: true,
    fact_blurb: PTA_FACT,
    played_at: null,
    finished_at: null,
    photo_query: null,
  } as Row;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/** Faithful-enough server: real PATCH schema, same field mapping as
 *  apply_question_authoring_patch, fact-blurb answers when released. */
function installServer() {
  const db = new Map<string, Row>([["q1", ptaRow()]]);
  const log: string[] = [];
  const patches: unknown[] = [];
  const heldFacts: Array<() => void> = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const fact = url.match(/\/api\/questions\/([^/]+)\/fact-blurb$/);
    if (fact && method === "POST") {
      const id = fact[1];
      log.push("POST fact-blurb");
      await new Promise<void>((r) => heldFacts.push(r));
      const row = db.get(id)!;
      const next = { ...row, fact_blurb: `AI FACT for: ${row.prompt.slice(0, 30)}` };
      db.set(id, next);
      return json({ question: next, blurb: next.fact_blurb });
    }
    const save = url.match(/\/api\/questions\/([^/]+)$/);
    if (save && method === "PATCH") {
      const body = JSON.parse(String(init?.body));
      patches.push(body);
      const parsed = PatchQuestionBodySchema.safeParse(body);
      if (!parsed.success) {
        const flat = parsed.error.flatten();
        const msg = flat.formErrors[0] ?? Object.values(flat.fieldErrors).flat()[0] ?? "invalid request body";
        log.push(`PATCH → 400 "${msg}"`);
        return json({ error: msg }, 400);
      }
      const p = parsed.data;
      const row = db.get(save[1])!;
      const next = {
        ...row,
        ...(p.prompt !== undefined ? { prompt: p.prompt } : {}),
        ...(p.options !== undefined ? { options: p.options } : {}),
        ...(p.correctIndex !== undefined ? { correct_index: p.correctIndex } : {}),
        ...(p.factBlurb !== undefined ? { fact_blurb: p.factBlurb } : {}),
        ...(p.pointValue !== undefined ? { point_value: p.pointValue } : {}),
        source: "host-edit",
      } as Row;
      db.set(save[1], next);
      log.push(`PATCH → 200 (fact saved as ${JSON.stringify(next.fact_blurb?.slice(0, 30) ?? null)})`);
      return json({ question: next });
    }
    return json({});
  }));
  return {
    db,
    log,
    patches,
    releaseFact: async () => {
      await act(async () => {
        heldFacts.shift()?.();
        await new Promise((r) => setTimeout(r, 20));
      });
    },
  };
}

function renderPick() {
  return render(
    <HostSetupPickClient
      nightId="night-1"
      categoryId="category-1"
      categoryName="Thanksgiving Movies"
      categoryTopic="thanksgiving movies"
      initialState="review"
      initialQuestions={[ptaRow()]}
      themeKey="november"
    />,
  );
}

function form() {
  const tas = document.querySelectorAll("textarea");
  const inputs = Array.from(document.querySelectorAll<HTMLInputElement>('[role="radio"] input'));
  return { prompt: tas[0] as HTMLTextAreaElement, fact: tas[1] as HTMLTextAreaElement, answers: inputs };
}
function type(el: HTMLInputElement | HTMLTextAreaElement, v: string) {
  fireEvent.change(el, { target: { value: v } });
}
async function openEditor() {
  fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]);
  await screen.findByRole("button", { name: /rewrite to match/i });
}
function retypeAsFreeBirds(answer4: string) {
  const f = form();
  type(f.prompt, "In the animated movie Free Birds, what are the two turkeys trying to accomplish?");
  type(f.answers[0], "Escape from a farm");
  type(f.answers[1], "Win a cooking competition");
  type(f.answers[2], "Travel back in time to remove turkey from Thanksgiving");
  type(f.answers[3], answer4);
  fireEvent.click(form().answers[2].closest('[role="radio"]')!);
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Question editor: Rewrite to match (2026-11-07)", () => {
  it("with answers 2 and 4 the same, says so on the rows and sends nothing", async () => {
    const s = installServer();
    renderPick();
    await openEditor();
    retypeAsFreeBirds("Win a cooking competition");

    expect(screen.getByTestId("answer-choice-problem").textContent).toBe(
      "Answers 2 and 4 are the same. Change one so all four are different.",
    );
    const rewrite = screen.getByRole("button", { name: /rewrite to match/i }) as HTMLButtonElement;
    expect(rewrite.disabled).toBe(true);
    fireEvent.click(rewrite);
    await new Promise((r) => setTimeout(r, 30));
    expect(s.patches).toHaveLength(0);
    expect(screen.queryByText(/options must be four distinct values/i)).toBeNull();

    // Fix answer 4 and the same button works: saves, then writes a new fact.
    type(form().answers[3], "Become the presidential turkey");
    fireEvent.click(screen.getByRole("button", { name: /rewrite to match/i }));
    await waitFor(() => expect(s.log).toContain("POST fact-blurb"));
    await s.releaseFact();
    await waitFor(() => expect(form().fact.value).toMatch(/^AI FACT for: In the animated movie Free Bir/));
  });

  it("locks the form while the fun fact is being written, so nothing typed is lost", async () => {
    const s = installServer();
    renderPick();
    await openEditor();
    retypeAsFreeBirds("Become the presidential turkey");
    fireEvent.click(screen.getByRole("button", { name: /rewrite to match/i }));
    await screen.findByRole("button", { name: /rewriting/i });

    const f = form();
    for (const el of [f.prompt, f.fact, ...f.answers]) expect(el.readOnly).toBe(true);
    expect(screen.getByTestId("host-gen-edit-busy").textContent).toMatch(/writing a fun fact/i);
    expect(
      (screen.getByRole("button", { name: /writing the fun fact/i }) as HTMLButtonElement).disabled,
    ).toBe(true);

    // A keystroke that slips through changes nothing.
    type(f.answers[3], "Win a turkey pardon");
    expect(form().answers[3].value).toBe("Become the presidential turkey");

    await s.releaseFact();
    await waitFor(() => expect(form().fact.value).toMatch(/^AI FACT for:/));
    const after = form();
    expect(after.answers[3].value).toBe("Become the presidential turkey");
    for (const el of [after.prompt, after.fact, ...after.answers]) expect(el.readOnly).toBe(false);
    type(after.answers[3], "Win a turkey pardon");
    expect(form().answers[3].value).toBe("Win a turkey pardon");
    expect(s.db.get("q1")!.options[3]).toBe("Become the presidential turkey");
  });
});
