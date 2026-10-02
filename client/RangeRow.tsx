/**
 * A `<input type="range">` settings row. React Native Web renders host
 * elements straight through to react-dom, so a plain DOM range input works
 * here — but only on web; GlassScreen must not mount this on native
 * (`layout.platform !== "web"`), since there is no DOM to render it into.
 */

import { createElement } from "react";
import type { PluginTheme } from "@getpaseo/plugin";
import { SettingsRow } from "@getpaseo/plugin/client/ui";

export interface RangeRowProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  disabled?: boolean;
  theme: PluginTheme;
  /** Formats the displayed hint; defaults to the raw value. */
  format?: (value: number) => string;
  onChange(value: number): void;
}

export default function RangeRow({
  label,
  value,
  min,
  max,
  step,
  disabled,
  theme,
  format,
  onChange,
}: RangeRowProps) {
  return (
    <SettingsRow label={label} hint={format ? format(value) : String(value)}>
      {createElement("input", {
        type: "range",
        min,
        max,
        step,
        value,
        disabled: Boolean(disabled),
        onChange: (event: { target: { value: string } }) => onChange(Number(event.target.value)),
        style: {
          width: "100%",
          accentColor: theme.colors.foreground,
          background: theme.colors.border,
          opacity: disabled ? 0.5 : 1,
        },
      })}
    </SettingsRow>
  );
}
