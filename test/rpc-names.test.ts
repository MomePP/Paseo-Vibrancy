import { test } from "node:test";
import assert from "node:assert/strict";

import {
  statusRpc,
  checkUpdateRpc,
  buildRpc,
  getSettingsRpc,
  setSettingsRpc,
} from "../shared/rpc.ts";

// Mirrors the SDK's own validation (node_modules/@getpaseo/plugin/dist/rpc.js);
// defineRpc throws at module-eval time for names that fail this pattern, so a
// bad name here would break every import of shared/rpc.ts.
const RPC_NAME = /^[a-z][a-z0-9._-]*$/;

test("every rpc contract name matches the SDK's allowed pattern", () => {
  for (const rpc of [statusRpc, checkUpdateRpc, buildRpc, getSettingsRpc, setSettingsRpc]) {
    assert.match(rpc.name, RPC_NAME, `${rpc.name} must match ${RPC_NAME}`);
  }
});
