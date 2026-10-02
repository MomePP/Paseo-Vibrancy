import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

import { GlassSettingsSchema } from "./glass.ts";

export const ReleaseSchema = z.object({
  version: z.string(),
  zipUrl: z.string(),
  sha512: z.string(),
  size: z.number(),
});

export type Release = z.infer<typeof ReleaseSchema>;

export const GlassStatusSchema = z.object({
  runningVersion: z.string().nullable(),
  runningGlassBuild: z.boolean(),
  builtFrom: z.string().nullable(),
  fingerprintMatches: z.boolean(),
  latest: ReleaseSchema.nullable(),
  lastReport: z.array(z.string()),
  building: z.boolean(),
});

export type GlassStatus = z.infer<typeof GlassStatusSchema>;

export const statusRpc = defineRpc({
  name: "glass.status",
  input: z.object({}),
  output: GlassStatusSchema,
});

export const checkUpdateRpc = defineRpc({
  name: "glass.check-update",
  input: z.object({}),
  output: z.object({
    release: ReleaseSchema.nullable(),
    error: z.string().nullable(),
  }),
});

export const buildRpc = defineRpc({
  name: "glass.build",
  input: z.object({
    version: z.string().optional(),
    restart: z.boolean(),
  }),
  output: z.object({
    ok: z.boolean(),
    report: z.array(z.string()),
    error: z.string().nullable(),
  }),
});

export const getGlassRpc = defineRpc({
  name: "glass.get-glass",
  input: z.object({}),
  output: GlassSettingsSchema,
});

export const setGlassRpc = defineRpc({
  name: "glass.set-glass",
  input: GlassSettingsSchema,
  output: GlassSettingsSchema,
});
