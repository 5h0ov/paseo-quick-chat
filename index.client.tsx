import type { PluginClientContext } from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { chatsWorkspace, isChat } from "./client/chats-workspace";
import { OpenChats } from "./client/open-chats";
import { contributePills } from "./client/pills";
import { CHATS_SCREEN, CONNECT_SCREEN, ConnectScreen, OPEN_AGENT_SCREEN, OpenAgentScreen } from "./client/screens";
import { SettingsScreen } from "./client/settings-screen";

export default function contribute(client: PluginClientContext) {
  const workspace = chatsWorkspace(client);
  const cleanups = [
    client.addScreen({ id: CHATS_SCREEN, title: "Quick chats", Component: (props) => <OpenChats {...props} rpc={client.rpc} /> }),
    client.addSidebarHeaderItem({
      id: "chats",
      title: "Quick chats",
      Component: ({ openScreen, currentScreen }) => (
        <SidebarRow
          icon="MessagesSquare"
          active={currentScreen?.screenId === CHATS_SCREEN}
          onPress={() => openScreen({ screenId: CHATS_SCREEN })}
        />
      ),
    }),
    client.addSettingsScreen({ id: "preferences", title: "Open Preferences", icon: "MessagesSquare", Component: SettingsScreen }),
    client.addScreen({ id: OPEN_AGENT_SCREEN, title: "Opening…", Component: OpenAgentScreen }),
    client.addScreen({
      id: CONNECT_SCREEN,
      title: "Connect chat to a project",
      Component: (props) => <ConnectScreen {...props} rpc={client.rpc} />,
    }),
    client.addCommandCenterItem({
      id: "new-chat",
      context: "global",
      title: "New quick chat",
      icon: "MessageSquarePlus",
      keywords: ["chat", "ask", "scratch", "general", "no project"],
      onSelect: (context) => context.openScreen({ screenId: CHATS_SCREEN }),
    }),
    client.addCommandCenterItem({
      id: "connect-chat",
      context: "agent",
      title: "Connect this chat to a project",
      icon: "FolderInput",
      keywords: ["quick chat", "move", "project"],
      onSelect: async (context) => {
        const chats = await workspace().catch(() => null);
        if (chats && isChat(context.agent.cwd, chats.directory)) {
          context.openScreen({ screenId: CONNECT_SCREEN, params: { agentId: context.agent.id } });
        } else {
          context.openScreen({ screenId: CHATS_SCREEN });
        }
      },
    }),
    contributePills(client, workspace),
  ];
  return () => {
    for (const cleanup of cleanups.reverse()) cleanup();
  };
}
