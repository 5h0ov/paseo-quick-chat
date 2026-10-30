import { useSettings, type PluginSurfaceProps } from "@getpaseo/plugin/client";
import { SettingsAction, SettingsCard, SettingsSection, SettingsSwitch } from "@getpaseo/plugin/client/ui";
import { Text, View } from "react-native";
import { preferences } from "../shared/preferences";
import { useText } from "./ui";

export function SettingsScreen({ theme }: PluginSurfaceProps) {
  const text = useText(theme);
  const settings = useSettings(preferences);
  if (settings.status === "loading") return <Text style={text.muted}>Loading…</Text>;
  if (settings.status !== "ready") {
    return (
      <View style={{ gap: 8 }}>
        <Text style={text.danger}>{settings.error}</Text>
        <SettingsAction label="Try again" actionLabel="Reload" onPress={() => void settings.reload()} />
        {settings.status === "invalid" ? (
          <SettingsAction label="Restore defaults" actionLabel="Reset" onPress={() => void settings.reset()} />
        ) : null}
      </View>
    );
  }
  const { values, revision } = settings;
  const save = (patch: Partial<typeof values>) => void settings.save({ ...values, ...patch }, revision);

  return (
    <SettingsSection title="Quick Chat">
      <SettingsCard>
        <SettingsSwitch
          label="Archive chats once connected"
          hint="So a chat isn't in two places. You can still open archived chats."
          value={values.archiveAfterConnect}
          onValueChange={(archiveAfterConnect) => save({ archiveAfterConnect })}
          disabled={settings.saving}
        />
        <SettingsSwitch
          label="Tell chats there's no project"
          hint="So new chats answer directly instead of looking for code."
          value={values.noProjectNote}
          onValueChange={(noProjectNote) => save({ noProjectNote })}
          disabled={settings.saving}
        />
      </SettingsCard>
      {settings.saveError ? <Text style={text.danger}>{settings.saveError}</Text> : null}
    </SettingsSection>
  );
}
