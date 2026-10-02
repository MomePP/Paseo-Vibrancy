// The plugin server runs inside Paseo's daemon, i.e. under Electron's Node
// (`Paseo Helper`, ELECTRON_RUN_AS_NODE), where `fs` treats every `*.asar`
// file as a virtual directory. Plain-Node tests can't see that, so these run
// the real code under the real runtime. Skipped when no Paseo is installed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

const PLUGIN_DIR = join(import.meta.dirname, "..");
const HELPER_SUFFIX = "Contents/Frameworks/Paseo Helper.app/Contents/MacOS/Paseo Helper";
const paseo = [join(homedir(), "Applications/Paseo-Vibrancy.app"), "/Applications/Paseo.app"].find((app) =>
  existsSync(join(app, HELPER_SUFFIX)),
);
const skip = paseo ? false : "no Paseo install to borrow an Electron runtime and app.asar from";

/** A minimal bundle holding a real asar archive (cloned, so it's cheap). */
function bundleWithAsar(dir: string): string {
  mkdirSync(join(dir, "Contents", "Resources"), { recursive: true });
  execFileSync("cp", ["-c", join(paseo!, "Contents/Resources/app.asar"), join(dir, "Contents/Resources/app.asar")]);
  return dir;
}

// The module under test is imported inside the child Electron process, which
// is the only place the asar-patched `fs` exists, so it can't be a static
// import of this (plain-Node) test file.
function runInElectron(code: string): { status: number | null; output: string } {
  const result = spawnSync(join(paseo!, HELPER_SUFFIX), ["--input-type=module", "-e", code], {
    cwd: PLUGIN_DIR,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    encoding: "utf8",
  });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

test("sweepOlderPristine removes an old bundle containing app.asar under Electron", { skip }, (t) => {
  const cache = mkdtempSync(join(tmpdir(), "vibrancy-efs-"));
  t.after(() => rmSync(cache, { recursive: true, force: true }));
  bundleWithAsar(join(cache, "Paseo-0.0.1.app"));

  const run = runInElectron(
    `const { sweepOlderPristine } = await import("./server/release.ts");
     await sweepOlderPristine(${JSON.stringify(cache)}, "0.11.0");`,
  );

  assert.equal(run.status, 0, run.output);
  assert.equal(existsSync(join(cache, "Paseo-0.0.1.app")), false);
});

test("buildStaging replaces a staging copy containing app.asar and reads the archive under Electron", { skip }, (t) => {
  const dir = mkdtempSync(join(tmpdir(), "vibrancy-efs-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  // Source has a real archive but no app-dist, so the build gets past
  // `rm(staging)`, ditto and the asar read/patch/write, then fails at the
  // renderer lookup and cleans up after itself.
  const source = bundleWithAsar(join(dir, "Source.app"));
  const staging = bundleWithAsar(join(dir, "Staging.app"));

  const run = runInElectron(
    `const { buildStaging } = await import("./server/build.ts");
     try {
       await buildStaging({ source: ${JSON.stringify(source)}, staging: ${JSON.stringify(staging)}, ghosttyPath: "/nonexistent" });
       console.log("RESULT unexpected success");
     } catch (e) {
       console.log("RESULT " + e.code + " " + e.message);
     }`,
  );

  const result = run.output.match(/^RESULT (.*)$/m)?.[1] ?? run.output;
  assert.match(result, /index\.html/, `expected the renderer lookup to be the first failure, got: ${result}`);
  assert.equal(existsSync(staging), false, "failed build must remove staging");
});
