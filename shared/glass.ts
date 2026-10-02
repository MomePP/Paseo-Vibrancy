import { z } from "zod";

export const MATERIALS = [
  "none",
  "sidebar",
  "hud",
  "under-window",
  "fullscreen-ui",
  "menu",
  "popover",
  "titlebar",
  "header",
  "sheet",
  "window",
  "content",
  "under-page",
  "selection",
  "tooltip",
] as const;

export const GLASS_DEFAULTS = {
  material: "none",
  blurRadius: 30,
  tint: 0.85,
  paneGlass: true,
} as const;

export const GlassSettingsSchema = z.object({
  material: z.enum(MATERIALS).catch(GLASS_DEFAULTS.material),
  blurRadius: z
    .number()
    .catch(GLASS_DEFAULTS.blurRadius)
    .transform((value) => Math.min(60, Math.max(0, value))),
  tint: z
    .number()
    .catch(GLASS_DEFAULTS.tint)
    .transform((value) => Math.min(1, Math.max(0, value))),
  paneGlass: z.boolean().catch(GLASS_DEFAULTS.paneGlass),
});

export type GlassSettings = z.infer<typeof GlassSettingsSchema>;

export function parseGlass(raw: unknown): GlassSettings {
  const input =
    raw !== null && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const result = GlassSettingsSchema.safeParse(input);
  if (result.success) {
    return result.data;
  }
  return { ...GLASS_DEFAULTS };
}
