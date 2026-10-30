import type { PluginHostProps } from "@getpaseo/plugin/client";
import { useMemo } from "react";
import { Pressable, Text } from "react-native";

export type Theme = PluginHostProps["theme"];

/** A small bordered button in the theme's raised surface colour. */
export function Button({ theme, label, onPress, disabled }: { theme: Theme; label: string; onPress(): void; disabled?: boolean }) {
  const { colors } = theme;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: Boolean(disabled) }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        alignSelf: "center",
        paddingHorizontal: 10,
        paddingVertical: 5,
        borderRadius: 7,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.surface2,
        opacity: disabled ? 0.55 : pressed ? 0.8 : 1,
      })}
    >
      <Text style={{ color: colors.foreground, fontSize: 12, fontWeight: "600" }}>{label}</Text>
    </Pressable>
  );
}

/** Text styles for the plugin's screens. */
export function useText(theme: Theme) {
  const { foreground, foregroundMuted, statusDanger } = theme.colors;
  return useMemo(
    () => ({
      title: { color: foreground, fontSize: 22, fontWeight: "700" as const },
      muted: { color: foregroundMuted, fontSize: 13 },
      danger: { color: statusDanger, fontSize: 13 },
    }),
    [foreground, foregroundMuted, statusDanger],
  );
}

/** A message for an error of any kind. */
export function describe(error: unknown): string {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  return message || "Something went wrong.";
}
