import type { PluginClientContext, PluginScreenProps } from "@getpaseo/plugin/client";
import { ScrollView } from "@getpaseo/plugin/client/ui";
import { useEffect } from "react";
import { Text, View } from "react-native";
import { ProjectPicker } from "./project-picker";
import { useText } from "./ui";

type Rpc = PluginClientContext["rpc"];

export const CHATS_SCREEN = "chats";
export const OPEN_AGENT_SCREEN = "open-agent";
export const CONNECT_SCREEN = "connect";

/** Popovers and commands can't navigate, but a screen can: this one just forwards to the agent. */
export function OpenAgentScreen({ theme, params, navigation }: PluginScreenProps) {
  const text = useText(theme);
  const agentId = params.agentId;
  useEffect(() => {
    if (agentId) navigation?.openAgent({ agentId });
  }, [agentId, navigation]);
  return (
    <View style={{ padding: 20 }}>
      <Text style={text.muted}>{agentId ? "Opening the agent…" : "Nothing to open."}</Text>
    </View>
  );
}

export function ConnectScreen({ theme, layout, host, params, navigation, rpc }: PluginScreenProps & { rpc: Rpc }) {
  const text = useText(theme);
  const agentId = params.agentId;
  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.surface0 }}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: layout.compact ? 16 : 24, gap: 12, maxWidth: 760, width: "100%", alignSelf: "center" }}
      >
        <Text style={text.title}>Connect chat to a project</Text>
        {agentId ? (
          <View style={{ borderWidth: 1, borderColor: theme.colors.border, borderRadius: 12, overflow: "hidden", backgroundColor: theme.colors.surface1 }}>
            <ProjectPicker
              theme={theme}
              rpc={rpc}
              agentId={agentId}
              hostLabel={host.label}
              compact={layout.compact}
              onConnected={(id) => navigation?.openAgent({ agentId: id })}
            />
          </View>
        ) : (
          <Text style={text.muted}>Open this from a quick chat.</Text>
        )}
      </ScrollView>
    </View>
  );
}
