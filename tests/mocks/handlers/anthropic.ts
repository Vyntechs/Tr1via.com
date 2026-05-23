// MSW handlers for the Anthropic Messages API.
//
// The app calls `client.beta.promptCaching.messages.create()` which the
// SDK forwards to `POST /v1/messages?beta=prompt_caching`. MSW matches on
// pathname, so a single handler on `https://api.anthropic.com/v1/messages`
// catches both the plain and the prompt-caching endpoints.
//
// Behavior:
//   * First call → returns the canned 20-question set (PIXAR_20).
//   * Second (and later) call → returns the 5-question retry set
//     (PIXAR_RETRY_5). Also triggered explicitly if the user message
//     mentions "more questions".
//   * `resetAnthropicMock()` zeroes the counter so tests can start fresh.
//
// Response shape mirrors lib/ai/generate-questions.ts → the tool_use
// block is named "emit_questions" and the input has a `questions: []`
// array of objects with `{ prompt, options, correctIndex, difficulty,
// factBlurb, photoQuery }`. The cache_*_input_tokens fields are present
// because the Prompt Caching beta SDK reads them off the response.

import { http, HttpResponse } from "msw";

import { PIXAR_20, PIXAR_RETRY_5 } from "../fixtures/questions";

let callCount = 0;

interface MessagesBody {
  messages?: Array<{
    role?: string;
    content?: string | Array<{ type?: string; text?: string }>;
  }>;
}

function extractUserText(body: MessagesBody | null): string {
  if (!body?.messages) return "";
  const parts: string[] = [];
  for (const m of body.messages) {
    if (!m.content) continue;
    if (typeof m.content === "string") {
      parts.push(m.content);
    } else if (Array.isArray(m.content)) {
      for (const block of m.content) {
        if (block && typeof block.text === "string") parts.push(block.text);
      }
    }
  }
  return parts.join("\n");
}

export const anthropicHandlers = [
  http.post("https://api.anthropic.com/v1/messages", async ({ request }) => {
    let body: MessagesBody | null = null;
    try {
      body = (await request.json()) as MessagesBody;
    } catch {
      body = null;
    }

    callCount++;
    const userText = extractUserText(body).toLowerCase();
    const isExplicitRetry = userText.includes("more questions");
    const isCountedRetry = callCount > 1;
    const isRetry = isExplicitRetry || isCountedRetry;

    const questions = isRetry ? PIXAR_RETRY_5 : PIXAR_20;

    return HttpResponse.json({
      id: `msg_test_${callCount}`,
      type: "message",
      role: "assistant",
      model: "claude-sonnet-4-6",
      content: [
        {
          type: "tool_use",
          id: `toolu_test_${callCount}`,
          name: "emit_questions",
          input: { questions },
        },
      ],
      stop_reason: "tool_use",
      stop_sequence: null,
      usage: {
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
        input_tokens: 100,
        output_tokens: 500,
      },
    });
  }),
];

/**
 * Reset the per-handler call counter so the next request gets the
 * "first call" response (PIXAR_20).
 */
export function resetAnthropicMock(): void {
  callCount = 0;
}
