import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { buildFingerprint, buildStaging, serialiseFingerprintInputs, stampFor } from "../server/build.ts";
import type { TermMetrics } from "../server/ghostty.ts";

const execFileAsync = promisify(execFile);

const BASE_TERM: TermMetrics = {
  fontSize: 13.5,
  lineHeight: 1.1,
  padding: "0 0 0 10px",
  cursorStyle: "bar",
  fontFamily: null,
  fontWeight: 400,
  fontWeightBold: 600,
};

test("buildFingerprint changes with term", () => {
  const a = buildFingerprint(BASE_TERM);
  const b = buildFingerprint({ ...BASE_TERM, lineHeight: 1.08 });
  assert.notEqual(a, b);
  assert.equal(a, buildFingerprint({ ...BASE_TERM }));
  assert.match(a, /^[0-9a-f]{12}$/);
});

test("fingerprint serialisation is sensitive to DEAD_UPDATE_YML, ASAR_HOOK_ANCHOR and BLUR_CLANG_ARGS", () => {
  const base = serialiseFingerprintInputs(BASE_TERM);
  assert.notEqual(base, serialiseFingerprintInputs(BASE_TERM, { deadUpdateYml: "something else" }));
  assert.notEqual(base, serialiseFingerprintInputs(BASE_TERM, { asarHookAnchor: "something else" }));
  assert.notEqual(base, serialiseFingerprintInputs(BASE_TERM, { blurClangArgs: ["something", "else"] }));
});

test('stampFor joins version and fingerprint as "<ver>|glass=<hash>"', () => {
  assert.equal(stampFor("0.11.0-beta.3", "abc"), "0.11.0-beta.3|glass=abc");
});

test("failed build leaves target untouched", async () => {
  const dir = mkdtempSync(join(tmpdir(), "glass-build-"));
  const source = join(dir, "NotAnApp.app");
  const staging = join(dir, "staging.app");
  mkdirSync(join(source, "Contents", "Resources"), { recursive: true });
  // No app.asar inside — buildStaging must reject before ever signing.
  try {
    await assert.rejects(() => buildStaging({ source, staging }));
    assert.equal(existsSync(staging), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

const pristine = process.env.GLASS_PRISTINE;
test(
  "builds pristine beta.3 cleanly",
  { skip: pristine ? false : "set GLASS_PRISTINE=<path to a verified pristine Paseo.app> to run" },
  async () => {
    const dir = mkdtempSync(join(tmpdir(), "glass-build-pristine-"));
    const staging = join(dir, "staging.app");
    try {
      const { report, missed } = await buildStaging({ source: pristine!, staging });

      const missedNotes = report.filter((note) => note.startsWith("MISSED"));
      assert.deepEqual(missedNotes, []);
      assert.equal(missed, false);

      await execFileAsync("codesign", ["--verify", "--deep", staging]);

      assert.equal(existsSync(join(staging, "Contents", "Resources", "pg.js")), true);
      assert.equal(existsSync(join(staging, "Contents", "Resources", "blur.node")), true);

      const stamp = readFileSync(join(staging, "Contents", "Resources", ".glass-build"), "utf8");
      assert.match(stamp, /^0\.11\.0-beta\.3\|glass=/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
