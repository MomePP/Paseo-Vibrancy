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

export const VIBRANCY_DEFAULTS = {
  material: "none",
  blurRadius: 30,
  tint: 0.85,
  paneGlass: true,
} as const;

export const VibrancySettingsSchema = z.object({
  material: z.enum(MATERIALS).catch(VIBRANCY_DEFAULTS.material),
  blurRadius: z
    .number()
    .catch(VIBRANCY_DEFAULTS.blurRadius)
    .transform((value) => Math.min(60, Math.max(0, value))),
  tint: z
    .number()
    .catch(VIBRANCY_DEFAULTS.tint)
    .transform((value) => Math.min(1, Math.max(0, value))),
  paneGlass: z.boolean().catch(VIBRANCY_DEFAULTS.paneGlass),
});

export type VibrancySettings = z.infer<typeof VibrancySettingsSchema>;

export function parseVibrancy(raw: unknown): VibrancySettings {
  const input =
    raw !== null && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const result = VibrancySettingsSchema.safeParse(input);
  if (result.success) {
    return result.data;
  }
  return { ...VIBRANCY_DEFAULTS };
}
