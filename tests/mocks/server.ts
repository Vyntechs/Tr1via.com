// Node-side MSW server boot for tests + the Next instrumentation hook.
//
// Tests import { mockServer, resetAnthropicMock } and call
// mockServer.listen()/close() in their lifecycle hooks. The Next
// instrumentation also imports mockServer to enable mocks at dev-server
// boot when MOCK_EXTERNAL=1.

import { setupServer } from "msw/node";

import { anthropicHandlers, resetAnthropicMock } from "./handlers/anthropic";
import { pexelsHandlers } from "./handlers/pexels";

export const mockServer = setupServer(
  ...anthropicHandlers,
  ...pexelsHandlers,
);

export { resetAnthropicMock };
