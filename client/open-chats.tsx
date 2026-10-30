import type { PluginClientContext, PluginSurfaceProps } from "@getpaseo/plugin/client";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { openChats } from "../shared/rpc";
import { Button, describe, useText } from "./ui";

type Rpc = PluginClientContext["rpc"];

/**
 * The sidebar entry: sets up the Quick chats workspace if needed, then hands over to Paseo's own
 * workspace view, so chats use the native new-agent tab and chat UI.
 */
export function OpenChats({ theme, navigation, rpc }: PluginSurfaceProps & { rpc: Rpc }) {
  const text = useText(theme);
  const [error, setError] = useState<string | null>(null);

  const open = useCallback(async () => {
    setError(null);
    try {
      const { workspaceId } = await rpc(openChats, {});
      if (navigation) navigation.openWorkspace({ workspaceId });
      else setError("This Paseo can't open it from here.");
    } catch (failure) {
      setError(describe(failure));
    }
  }, [rpc, navigation]);

  useEffect(() => {
    void open();
  }, [open]);

  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 24, backgroundColor: theme.colors.surface0 }}>
      {error ? (
        <>
          <Text style={[text.danger, { textAlign: "center" }]}>Couldn't open Quick chats: {error}</Text>
          <Button theme={theme} label="Try again" onPress={() => void open()} />
        </>
      ) : (
        <>
          <ActivityIndicator color={theme.colors.foregroundMuted} />
          <Text style={text.muted}>Opening Quick chats…</Text>
        </>
      )}
    </View>
  );
}
