import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import type { ProjectChoice } from "../shared/rpc";
import { buildTranscript, connectPrompt } from "./handoff";
import { shortPath } from "./folders";

export type PaseoApi = PluginHandlerContext["paseo"];
type Agent = Awaited<ReturnType<PaseoApi["agents"]["list"]>>["entries"][number]["agent"];
type Workspace = Awaited<ReturnType<PaseoApi["workspaces"]["list"]>>["entries"][number];

/** On the agent a chat was carried over into: the chat it came from. */
export const CONNECTED_FROM_LABEL = "quick-chat.connected-from";

const WORKSPACE_TITLE = "Quick chats";
const MAX_PAGES = 20;

const PROVIDER_NAMES: Record<string, string> = { claude: "Claude", codex: "Codex", opencode: "OpenCode" };

const SYSTEM_PROMPT = [
  "You are in a general chat that isn't attached to any project.",
  "Your working directory is a scratch folder the user doesn't look at, so don't assume there is code to read.",
  "Answer questions directly. If the user wants work done on a codebase, tell them they can connect this chat to a project.",
].join(" ");

export class UserError extends Error {}

export function defaultScratchDir(): string {
  return path.join(homedir(), ".paseo", "quick-chat");
}

function norm(value: string): string {
  const resolved = path.resolve(value).replace(/[\\/]+$/, "");
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function samePath(a: string | null | undefined, b: string): boolean {
  return Boolean(a) && norm(a!) === norm(b);
}

function isUnder(child: string | null | undefined, root: string): boolean {
  if (!child) return false;
  const a = norm(child);
  const b = norm(root);
  return a === b || a.startsWith(b + path.sep);
}

function workspaceDir(workspace: Workspace): string {
  return workspace.workspaceDirectory ?? workspace.projectRootPath;
}

function providerLabel(id: string): string {
  return PROVIDER_NAMES[id] ?? id.charAt(0).toUpperCase() + id.slice(1);
}

function isBusy(agent: Agent): boolean {
  return agent.status === "running" || agent.status === "initializing" || Boolean(agent.activeTurn);
}

export class Chats {
  /** Serialises workspace setup, so two chats started at once don't register the folder twice. */
  private workspace: Promise<string> | null = null;
  /** Connects in flight, keyed by chat, so a double click doesn't start two copies. */
  private connecting = new Map<string, Promise<{ agentId: string; workspaceId: string }>>();

  constructor(
    private readonly scratchDir = defaultScratchDir(),
    /** Where to report what happened; shown under the plugin's Logs in Paseo. */
    private readonly log: (message: string) => void = (message) => console.log(`[Quick Chat] ${message}`),
  ) {}

  /** Quick chats are the agents in the chats folder, however they were started. */
  isChat(cwd: string | null | undefined): boolean {
    return isUnder(cwd, this.scratchDir);
  }

  /** The Quick chats workspace, set up first if needed. Opened in Paseo, it's a native blank chat. */
  openWorkspace(paseo: PaseoApi): Promise<string> {
    return this.ensureWorkspace(paseo);
  }

  get directory(): string {
    return this.scratchDir;
  }

  /** Adds the "no project" note to an agent started in the chats folder. */
  withSystemPrompt<Config extends { cwd: string; systemPrompt?: string }>(config: Config): Config | null {
    if (!this.isChat(config.cwd) || config.systemPrompt?.includes(SYSTEM_PROMPT)) return null;
    this.log(`Added the no-project note to a new chat in ${config.cwd}`);
    return { ...config, systemPrompt: config.systemPrompt?.trim() ? `${config.systemPrompt.trim()}

${SYSTEM_PROMPT}` : SYSTEM_PROMPT };
  }

  async projects(paseo: PaseoApi): Promise<ProjectChoice[]> {
    return (await listWorkspaces(paseo))
      .filter((workspace) => !workspace.archivingAt && !workspace.internal && !samePath(workspaceDir(workspace), this.scratchDir))
      .map((workspace) => ({
        workspaceId: workspace.id,
        label: projectLabel(workspace),
        directory: workspaceDir(workspace),
        shortDirectory: shortPath(workspaceDir(workspace)),
        worktree: workspace.workspaceKind === "worktree",
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }

  connect(
    paseo: PaseoApi,
    input: { agentId: string; workspaceId: string; archiveOriginal: boolean },
  ): Promise<{ agentId: string; workspaceId: string }> {
    const running = this.connecting.get(input.agentId);
    if (running) return running;
    this.log(`Connecting chat ${input.agentId.slice(0, 8)} to workspace ${input.workspaceId}`);
    const task = this.connectNow(paseo, input)
      .then(
        (result) => {
          this.log(`Connected chat ${input.agentId.slice(0, 8)}: continues as ${result.agentId.slice(0, 8)}${input.archiveOriginal ? "; chat archived" : ""}`);
          return result;
        },
        (error: unknown) => {
          this.log(`Couldn't connect chat ${input.agentId.slice(0, 8)}: ${error instanceof Error ? error.message : String(error)}`);
          throw error;
        },
      )
      .finally(() => this.connecting.delete(input.agentId));
    this.connecting.set(input.agentId, task);
    return task;
  }

  private async connectNow(
    paseo: PaseoApi,
    input: { agentId: string; workspaceId: string; archiveOriginal: boolean },
  ): Promise<{ agentId: string; workspaceId: string }> {
    const chat = (await paseo.agents.ref(input.agentId).refresh())?.agent;
    if (!chat) throw new UserError("That chat no longer exists.");
    if (!this.isChat(chat.cwd)) throw new UserError("Only quick chats can be connected to a project.");
    if (isBusy(chat)) throw new UserError("Still replying. Try again when it's done.");
    if (chat.pendingPermissions.length > 0) {
      throw new UserError("Waiting for you to allow or deny something. Answer it first.");
    }

    const workspace = (await listWorkspaces(paseo)).find((entry) => entry.id === input.workspaceId);
    if (!workspace || workspace.archivingAt) throw new UserError("That project isn't open any more.");
    const directory = workspaceDir(workspace);
    if (samePath(directory, this.scratchDir)) throw new UserError("Pick a real project.");

    // A retry after a timeout or a daemon restart finds the copy it already started.
    const existing = (await listAgents(paseo, { [CONNECTED_FROM_LABEL]: chat.id })).find(
      (agent) => agent.workspaceId === workspace.id,
    );
    if (existing) {
      await this.finish(paseo, chat, existing.id, input.archiveOriginal);
      return { agentId: existing.id, workspaceId: workspace.id };
    }

    const page = await paseo.agents.ref(chat.id).timeline.refetch({ direction: "tail", limit: 500 });
    const transcript = buildTranscript(page.entries.map((entry) => entry.item));
    const model = chat.model ?? chat.runtimeInfo?.model ?? (await defaultModel(paseo, chat.provider));
    if (!model) throw new UserError(`No ${providerLabel(chat.provider)} model found.`);

    // The chat's mode is left behind on purpose: a project gets the provider's default (and so its
    // usual permission prompts), not whatever was fine in a scratch folder.
    const copy = await paseo.workspaces.ref(workspace.id).agents.create({
      config: {
        provider: `${chat.provider}/${model}`,
        ...(chat.thinkingOptionId ? { thinkingOptionId: chat.thinkingOptionId } : {}),
      },
      title: chat.title?.trim() || "Chat",
      prompt: connectPrompt(transcript, directory),
      idempotencyKey: `quick-chat.connect.${chat.id}.${workspace.id}`,
      labels: { [CONNECTED_FROM_LABEL]: chat.id },
    });
    await this.finish(paseo, chat, copy.id, input.archiveOriginal);
    return { agentId: copy.id, workspaceId: workspace.id };
  }

  /** Best effort: the copy exists by now, and that's what the user asked for. */
  private async finish(paseo: PaseoApi, chat: Agent, copyId: string, archive: boolean): Promise<void> {
    if (!archive || chat.archivedAt) return;
    try {
      await paseo.agents.ref(chat.id).archive();
    } catch (error) {
      console.error(`[Quick Chat] connected ${chat.id} to ${copyId} but couldn't archive the chat`, error);
    }
  }

  private ensureWorkspace(paseo: PaseoApi): Promise<string> {
    const pending = (this.workspace ??= this.findOrCreateWorkspace(paseo));
    // A failure (or a workspace archived since) shouldn't stick: the next chat tries again.
    return pending.then(
      async (id) => {
        const current = await paseo.workspaces.ref(id).refresh().catch(() => null);
        if (current && !current.archivingAt) return id;
        if (this.workspace === pending) this.workspace = null;
        return this.ensureWorkspace(paseo);
      },
      (error: unknown) => {
        if (this.workspace === pending) this.workspace = null;
        throw error;
      },
    );
  }

  private async findOrCreateWorkspace(paseo: PaseoApi): Promise<string> {
    // Recreated every time: someone may have deleted the folder since the last chat.
    await mkdir(this.scratchDir, { recursive: true });
    // A background workspace: opened by the plugin, but not listed as a project in the sidebar.
    const found = (await listWorkspaces(paseo, true)).find(
      (workspace) => workspace.background && !workspace.archivingAt && samePath(workspaceDir(workspace), this.scratchDir),
    );
    if (found) {
      if (found.title !== WORKSPACE_TITLE) await paseo.workspaces.ref(found.id).setTitle(WORKSPACE_TITLE).catch(() => undefined);
      this.log(`Using the Quick chats workspace ${found.id} (${this.scratchDir})`);
      return found.id;
    }
    const created = await paseo.workspaces.create({
      source: { kind: "directory", path: this.scratchDir },
      title: WORKSPACE_TITLE,
      background: true,
    });
    this.log(`Created the Quick chats workspace ${created.id} (${this.scratchDir})`);
    return created.id;
  }
}

function projectLabel(workspace: Workspace): string {
  const project = workspace.projectCustomName?.trim() || workspace.projectDisplayName;
  if (workspace.workspaceKind === "directory" || workspace.workspaceKind === "checkout") return project;
  const name = workspace.title?.trim() || workspace.name;
  return name && name !== project ? `${project} · ${name}` : project;
}

async function defaultModel(paseo: PaseoApi, provider: string): Promise<string | null> {
  try {
    const { models } = await paseo.providers.listModels(provider);
    return (models?.find((entry) => entry.isDefault) ?? models?.[0])?.id ?? null;
  } catch {
    return null;
  }
}

async function listAgents(paseo: PaseoApi, labels: Record<string, string>): Promise<Agent[]> {
  const agents: Agent[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const result = await paseo.agents.list({
      ...(Object.keys(labels).length ? { filter: { labels } } : {}),
      page: { limit: 200, ...(cursor ? { cursor } : {}) },
    });
    for (const { agent } of result.entries) agents.push(agent);
    if (!result.pageInfo.hasMore || !result.pageInfo.nextCursor) break;
    cursor = result.pageInfo.nextCursor;
  }
  return agents;
}

async function listWorkspaces(paseo: PaseoApi, includeBackground = false): Promise<Workspace[]> {
  const workspaces: Workspace[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const result = await paseo.workspaces.list({
      ...(includeBackground ? { filter: { includeBackground: true } } : {}),
      page: { limit: 200, ...(cursor ? { cursor } : {}) },
    });
    workspaces.push(...result.entries);
    if (!result.pageInfo.hasMore || !result.pageInfo.nextCursor) break;
    cursor = result.pageInfo.nextCursor;
  }
  return workspaces;
}
