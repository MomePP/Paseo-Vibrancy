import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { startSwap, swapScript } from "../server/swap.ts";
import { STAMP_NAME } from "../server/build.ts";

/**
 * Polls `predicate` up to `timeoutMs`. Exception to fake-timer-only polling:
 * `startSwap` detaches a real `/bin/sh` child that mutates the filesystem
 * out-of-process (`mv`), so there is no in-process event or promise to await
 * — only the platform clock and the resulting files on disk.
 */
function sleep(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await sleep(50);
  }
  assert.ok(predicate(), `condition not met within ${timeoutMs}ms`);
}

function makeStaging(dir: string, marker: string): string {
  const staging = join(dir, "staging.app");
  mkdirSync(join(staging, "Contents", "Resources"), { recursive: true });
  writeFileSync(join(staging, "Contents", "Resources", STAMP_NAME), "0.11.0-beta.3|glass=abc123");
  writeFileSync(join(staging, "Contents", "Resources", "marker.txt"), marker);
  return staging;
}

test("swaps staging into target and trashes old", async () => {
  const dir = mkdtempSync(join(tmpdir(), "glass-swap-"));
  try {
    const staging = makeStaging(dir, "new-build");
    const target = join(dir, "target.app");
    mkdirSync(join(target, "Contents", "Resources"), { recursive: true });
    writeFileSync(join(target, "Contents", "Resources", "marker.txt"), "old-build");
    const trashDir = mkdtempSync(join(tmpdir(), "glass-trash-"));

    try {
      startSwap({ staging, target, quit: false, open: false, trashDir, logPath: join(dir, "swap.log") });

      await waitFor(() => !existsSync(staging));
      assert.equal(readFileSync(join(target, "Contents", "Resources", "marker.txt"), "utf8"), "new-build");
      assert.equal(existsSync(staging), false);

      const trashed = readdirSync(trashDir).filter((name) => name.startsWith("Paseo-Vibrancy-"));
      assert.equal(trashed.length, 1);
      assert.ok(trashed[0]!.endsWith(".app"));
      assert.equal(
        readFileSync(join(trashDir, trashed[0]!, "Contents", "Resources", "marker.txt"), "utf8"),
        "old-build",
      );
    } finally {
      rmSync(trashDir, { recursive: true, force: true });
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("refuses staging without stamp", () => {
  const dir = mkdtempSync(join(tmpdir(), "glass-swap-"));
  try {
    const staging = join(dir, "staging.app");
    mkdirSync(join(staging, "Contents", "Resources"), { recursive: true });
    // No .glass-build stamp written.
    const target = join(dir, "target.app");
    mkdirSync(join(target, "Contents", "Resources"), { recursive: true });
    writeFileSync(join(target, "Contents", "Resources", "marker.txt"), "old-build");
    const trashDir = mkdtempSync(join(tmpdir(), "glass-trash-"));

    try {
      assert.throws(
        () => startSwap({ staging, target, quit: false, open: false, trashDir }),
        /staging has no build stamp/,
      );
      assert.equal(existsSync(staging), true);
      assert.equal(
        readFileSync(join(target, "Contents", "Resources", "marker.txt"), "utf8"),
        "old-build",
      );
      assert.deepEqual(readdirSync(trashDir), []);
    } finally {
      rmSync(trashDir, { recursive: true, force: true });
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("works when target does not exist yet", async () => {
  const dir = mkdtempSync(join(tmpdir(), "glass-swap-"));
  try {
    const staging = makeStaging(dir, "first-install");
    const target = join(dir, "target.app");
    const trashDir = mkdtempSync(join(tmpdir(), "glass-trash-"));

    try {
      startSwap({ staging, target, quit: false, open: false, trashDir, logPath: join(dir, "swap.log") });

      await waitFor(() => existsSync(join(target, "Contents", "Resources", "marker.txt")));
      assert.equal(readFileSync(join(target, "Contents", "Resources", "marker.txt"), "utf8"), "first-install");
      assert.equal(existsSync(staging), false);
      assert.deepEqual(readdirSync(trashDir), []);
    } finally {
      rmSync(trashDir, { recursive: true, force: true });
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a MISSED stamp is still swappable", async () => {
  const dir = mkdtempSync(join(tmpdir(), "glass-swap-"));
  try {
    const staging = join(dir, "staging.app");
    mkdirSync(join(staging, "Contents", "Resources"), { recursive: true });
    writeFileSync(join(staging, "Contents", "Resources", STAMP_NAME), "0.11.0-beta.3|glass=missed");
    writeFileSync(join(staging, "Contents", "Resources", "marker.txt"), "missed-build");
    const target = join(dir, "target.app");
    const trashDir = mkdtempSync(join(tmpdir(), "glass-trash-"));

    try {
      startSwap({ staging, target, quit: false, open: false, trashDir, logPath: join(dir, "swap.log") });

      await waitFor(() => existsSync(join(target, "Contents", "Resources", "marker.txt")));
      assert.equal(readFileSync(join(target, "Contents", "Resources", "marker.txt"), "utf8"), "missed-build");
    } finally {
      rmSync(trashDir, { recursive: true, force: true });
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("quotes paths containing spaces and single quotes safely", async () => {
  const dir = mkdtempSync(join(tmpdir(), "glass-swap-"));
  try {
    const trickyRoot = join(dir, "Paseo Helper's App Support");
    mkdirSync(trickyRoot, { recursive: true });

    const staging = makeStaging(trickyRoot, "tricky-build");
    const target = join(trickyRoot, "Paseo-Vibrancy's Copy.app");
    const trashDir = join(trickyRoot, "O'Brien's Trash");
    mkdirSync(trashDir, { recursive: true });

    startSwap({ staging, target, quit: false, open: false, trashDir, logPath: join(trickyRoot, "swap.log") });

    await waitFor(() => existsSync(join(target, "Contents", "Resources", "marker.txt")));
    assert.equal(readFileSync(join(target, "Contents", "Resources", "marker.txt"), "utf8"), "tricky-build");
    assert.equal(existsSync(staging), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("swapScript quits the running copy and waits for it to clear, but omits that when quit is false", () => {
  const opts = { staging: "/tmp/staging.app", target: "/tmp/target.app", trashDir: "/tmp/trash", open: false };

  const withQuit = swapScript({ ...opts, quit: true });
  assert.match(withQuit, /tell application id "sh\.paseo\.desktop" to quit/);
  assert.match(withQuit, /pgrep -f "\$PATTERN"/);
  assert.match(withQuit, /PATTERN='\^\/tmp\/target\\\.app\/Contents\/MacOS\/Paseo\$'/);
  assert.match(withQuit, /^if pgrep -f "\$PATTERN".*\n {2}echo .*\n {2}exit 1\nfi$/m);

  const withoutQuit = swapScript({ ...opts, quit: false });
  assert.doesNotMatch(withoutQuit, /osascript/);
  assert.doesNotMatch(withoutQuit, /pgrep/);
});

test("quit wait tracks both the target's and the currently-running bundle's executables", () => {
  const withBoth = swapScript({
    staging: "/tmp/staging.app",
    target: "/tmp/Paseo-Vibrancy.app",
    runningExe: "/Applications/Paseo.app/Contents/MacOS/Paseo",
    trashDir: "/tmp/trash",
    quit: true,
    open: false,
  });
  assert.match(withBoth, /PATTERN='\^\/tmp\/Paseo-Vibrancy\\\.app\/Contents\/MacOS\/Paseo\$'/);
  assert.match(withBoth, /RUNNING_PATTERN='\^\/Applications\/Paseo\\\.app\/Contents\/MacOS\/Paseo\$'/);
  assert.match(withBoth, /pgrep -f "\$PATTERN" >\/dev\/null 2>&1 \|\| pgrep -f "\$RUNNING_PATTERN" >\/dev\/null 2>&1 \|\| break/);
  assert.equal(spawnSync("/bin/sh", ["-n", "-c", withBoth]).status, 0, "generated script must be valid POSIX sh");

  // runningExe identical to the target's own exe: no second pattern needed.
  const sameExe = swapScript({
    staging: "/tmp/staging.app",
    target: "/tmp/target.app",
    runningExe: "/tmp/target.app/Contents/MacOS/Paseo",
    trashDir: "/tmp/trash",
    quit: true,
    open: false,
  });
  assert.doesNotMatch(sameExe, /RUNNING_PATTERN/);
});

test("every failure branch after the quit request reopens the previous app when open is true", () => {
  const script = swapScript({
    staging: "/tmp/staging.app",
    target: "/tmp/target.app",
    trashDir: "/tmp/trash",
    quit: true,
    open: true,
  });
  const reopenCount = [...script.matchAll(/open -a '\/tmp\/target\.app'/g)].length;
  // quit-timeout, trash-move-failed, staging-move-failed, and the final success open: four call sites.
  assert.equal(reopenCount, 4);
  assert.equal(spawnSync("/bin/sh", ["-n", "-c", script]).status, 0, "generated script must be valid POSIX sh");
});

test("logs timestamped steps and the failure reason to logPath", () => {
  const dir = mkdtempSync(join(tmpdir(), "glass-swap-"));
  try {
    const target = join(dir, "target.app");
    mkdirSync(join(target, "Contents", "Resources"), { recursive: true });
    writeFileSync(join(target, "Contents", "Resources", "marker.txt"), "old-build");
    const staging = join(dir, "no-such-staging.app"); // deliberately never created, forces a failure
    const trashDir = mkdtempSync(join(tmpdir(), "glass-trash-"));
    const logPath = join(dir, "swap.log");

    try {
      const script = swapScript({ staging, target, trashDir, quit: false, open: false, logPath });
      const result = spawnSync("/bin/sh", ["-c", script]);

      assert.notEqual(result.status, 0);
      const log = readFileSync(logPath, "utf8");
      assert.match(log, /^\[\S+\] swap: starting$/m);
      assert.match(log, /^\[\S+\] swap: staging move failed, restoring previous app$/m);
    } finally {
      rmSync(trashDir, { recursive: true, force: true });
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a failed trash-move aborts before staging is touched (e.g. a missing trashDir)", () => {
  const dir = mkdtempSync(join(tmpdir(), "glass-swap-"));
  try {
    const staging = makeStaging(dir, "new-build");
    const target = join(dir, "target.app");
    mkdirSync(join(target, "Contents", "Resources"), { recursive: true });
    writeFileSync(join(target, "Contents", "Resources", "marker.txt"), "old-build");
    const trashDir = join(dir, "no-such-trash-dir"); // deliberately never created

    const script = swapScript({ staging, target, trashDir, quit: false, open: false, logPath: join(dir, "swap.log") });
    const result = spawnSync("/bin/sh", ["-c", script]);

    assert.notEqual(result.status, 0);
    assert.equal(existsSync(staging), true);
    assert.equal(
      readFileSync(join(target, "Contents", "Resources", "marker.txt"), "utf8"),
      "old-build",
    );
    // The failed mv must never have nested staging inside the still-live target.
    assert.equal(existsSync(join(target, "staging.app")), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a failed staging-move restores the trashed target", () => {
  const dir = mkdtempSync(join(tmpdir(), "glass-swap-"));
  try {
    const target = join(dir, "target.app");
    mkdirSync(join(target, "Contents", "Resources"), { recursive: true });
    writeFileSync(join(target, "Contents", "Resources", "marker.txt"), "old-build");
    const trashDir = mkdtempSync(join(tmpdir(), "glass-trash-"));
    const staging = join(dir, "no-such-staging.app"); // deliberately never created

    try {
      const script = swapScript({ staging, target, trashDir, quit: false, open: false, logPath: join(dir, "swap.log") });
      const result = spawnSync("/bin/sh", ["-c", script]);

      assert.notEqual(result.status, 0);
      assert.equal(
        readFileSync(join(target, "Contents", "Resources", "marker.txt"), "utf8"),
        "old-build",
      );
      assert.deepEqual(readdirSync(trashDir), []);
    } finally {
      rmSync(trashDir, { recursive: true, force: true });
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("escapes regex metacharacters in the exe path so pgrep -f matches only the literal path", () => {
  const target = "/tmp/Paseo (x)+.app";
  const exe = join(target, "Contents", "MacOS", "Paseo");
  const script = swapScript({ staging: "/tmp/staging.app", target, trashDir: "/tmp/trash", quit: true, open: false });

  const patternLine = script.match(/^PATTERN='(.*)'$/m);
  assert.ok(patternLine, "expected a single-quoted PATTERN= assignment line");
  const pattern = patternLine![1]!.replaceAll(`'\\''`, "'");

  // Mirrors pgrep's own matcher (extended regular expressions).
  const literalMatch = spawnSync("/bin/sh", ["-c", `echo '${exe}' | grep -E '${pattern}'`]);
  assert.equal(literalMatch.status, 0);
});
