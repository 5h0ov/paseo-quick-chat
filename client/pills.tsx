import type { PluginButtonContentProps, PluginButtonRegistration, PluginClientContext } from "@getpaseo/plugin/client";
import { View } from "react-native";
import { isChat, type ChatsLocation } from "./chats-workspace";
import { ProjectPicker } from "./project-picker";
import { OPEN_AGENT_SCREEN } from "./screens";

const PAGE_SIZE = 200;
const MAX_PAGES = 10;

interface Agent {
  id: string;
  cwd: string;
  workspaceId?: string | null;
  archivedAt?: string | null;
}

/**
 * A "Connect to project" pill in the composer of every quick chat. Agents are watched through a
 * list subscription: `agents.subscribe` alone gets no updates.
 */
export function contributePills(client: PluginClientContext, chatsWorkspace: () => Promise<ChatsLocation>): () => void {
  const chats = new Map<string, string>(); // agent → workspace
  const pills = new Map<string, PluginButtonRegistration>();
  const lifetime = new AbortController();
  let directory: string | null = null;
  let stopped = false;

  function Content(props: PluginButtonContentProps) {
    if (props.context !== "agent") return null;
    const { theme, agentId, close } = props;
    return (
      <View style={{ width: 440, maxWidth: "100%" }}>
        <ProjectPicker
          theme={theme}
          rpc={client.rpc}
          agentId={agentId}
          hostLabel={props.host.label}
          compact={props.layout.compact}
          onCancel={close}
          onConnected={(id) => {
            close();
            client.openScreen({ screenId: OPEN_AGENT_SCREEN, params: { agentId: id } });
          }}
        />
      </View>
    );
  }

  const track = (agent: Agent) => {
    if (directory && agent.workspaceId && !agent.archivedAt && isChat(agent.cwd, directory)) chats.set(agent.id, agent.workspaceId);
    else chats.delete(agent.id);
  };

  function sync(): void {
    if (stopped) return;
    for (const [agentId, pill] of pills) {
      if (chats.has(agentId)) continue;
      pill.remove();
      pills.delete(agentId);
    }
    for (const [agentId, workspaceId] of chats) {
      if (pills.has(agentId)) continue;
      try {
        pills.set(
          agentId,
          client.addComposerPill({
            id: "connect",
            workspaceId,
            agentId,
            button: { title: "Continue this chat in a project", label: "Connect to project", icon: "FolderInput", behavior: { kind: "popover", Content } },
          }),
        );
      } catch (error) {
        console.warn("[Quick Chat] could not add the connect pill", error);
      }
    }
  }

  // The subscription covers the newest page and every later change; older chats come from the
  // remaining pages, so a chat idle for a while still gets its pill.
  const newestFirst = () => [{ key: "updated_at" as const, direction: "desc" as const }];
  // The chats workspace is a background one, and Paseo leaves its agents out of lists by default.
  const withChats = { filter: { includeBackground: true } };
  let snapshots = 0;
  async function loadOlder(cursor: string | null, generation: number): Promise<void> {
    for (let page = 1; cursor && page < MAX_PAGES; page += 1) {
      const result = await client.paseo.agents.list({ ...withChats, signal: lifetime.signal, sort: newestFirst(), page: { limit: PAGE_SIZE, cursor } });
      if (stopped || generation !== snapshots) return;
      for (const { agent } of result.entries) track(agent);
      sync();
      cursor = result.pageInfo.hasMore ? (result.pageInfo.nextCursor ?? null) : null;
    }
  }

  void chatsWorkspace()
    .then((location) => {
      directory = location.directory;
      return client.paseo.agents.list({ ...withChats, subscribe: {}, signal: lifetime.signal, sort: newestFirst(), page: { limit: PAGE_SIZE } });
    })
    .then(({ subscription }) => {
      subscription.subscribe({
        snapshot: ({ entries, pageInfo }) => {
          const generation = ++snapshots;
          chats.clear();
          for (const { agent } of entries) track(agent);
          sync();
          void loadOlder(pageInfo.hasMore ? (pageInfo.nextCursor ?? null) : null, generation).catch((error: unknown) => {
            if (!stopped) console.warn("[Quick Chat] could not list older agents", error);
          });
        },
        update: (message) => {
          if (message.type !== "agent_update") return;
          const update = message.payload;
          if (update.kind === "remove") chats.delete(update.agentId);
          else track(update.agent);
          sync();
        },
      });
    })
    .catch((error: unknown) => {
      if (!stopped) console.error("[Quick Chat] watching chats failed", error);
    });

  return () => {
    stopped = true;
    lifetime.abort();
    for (const pill of pills.values()) pill.remove();
    pills.clear();
  };
}
