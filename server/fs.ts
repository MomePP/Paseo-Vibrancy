// The filesystem for anything that touches an app bundle.
//
// The plugin server runs inside Paseo's daemon, which is Electron's Node
// (`Paseo Helper` with ELECTRON_RUN_AS_NODE). There `node:fs` is patched to
// treat every `*.asar` file as a virtual directory: `rm -r` on a bundle
// recurses into `app.asar` instead of unlinking it and then fails with
// ENOTEMPTY on `Contents/Resources`, and `readFile(app.asar)` is ENOENT.
// Electron ships the unpatched module as `original-fs`; plain Node (tests) has
// no such builtin and no asar patch, so `node:fs` is already correct there.
//
// Both modules come from `process.getBuiltinModule` rather than an import: a
// default or namespace import of `node:fs` makes Paseo's plugin bundler read
// every export eagerly, which trips Node's `fs.F_OK` deprecation warning.
import type * as NodeFs from "node:fs";

export const fs = (process.getBuiltinModule("original-fs") ?? process.getBuiltinModule("node:fs")) as typeof NodeFs;
export const fsp = fs.promises;
