import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CONNECTED_FROM_LABEL, Chats, type PaseoApi } from "./chats";

interface FakeAgent {
  id: string;
  provider: string;
  cwd: string;
  workspaceId?: string;
  model: string | null;
  status: string;
  activeTurn?: unknown;
  pendingPermissions: unknown[];
  title: string | null;
  labels: Record<string, string>;
  archivedAt?: string | null;
  updatedAt: string;
  thinkingOptionId?: string | null;
  runtimeInfo?: { model?: string };
}

interface FakeWorkspace {
  id: string;
  projectId: string;
  projectDisplayName: string;
  projectRootPath: string;
  workspaceDirectory?: string;
  workspaceKind: string;
  name: string;
  title?: string | null;
  archivingAt?: string | null;
  background?: boolean;
}

function fakePaseo(options: { providers?: string[]; workspaces?: FakeWorkspace[] } = {}) {
  const agents: FakeAgent[] = [];
  const workspaces: FakeWorkspace[] = [...(options.workspaces ?? [])];
  const created: Array<{ workspaceId: string; request: Record<string, unknown> }> = [];
  const opened: string[] = [];
  const keys = new Map<string, string>();
  let next = 0;

  const agentHandle = (id: string) => ({
    refresh: async () => {
      const agent = agents.find((entry) => entry.id === id);
      return agent ? { agent, project: null } : null;
    },
    archive: async () => {
      const agent = agents.find((entry) => entry.id === id)!;
      agent.archivedAt = new Date().toISOString();
      return { archivedAt: agent.archivedAt };
    },
    timeline: {
      refetch: async () => ({
        entries: [
          { item: { type: "user_message", text: "What is a monad?" } },
          { item: { type: "assistant_message", text: "A monoid in the category of endofunctors." } },
        ],
      }),
    },
  });

  const paseo = {
    providers: {
      listAvailable: async () => ({
        providers: (options.providers ?? ["codex", "claude"]).map((provider) => ({ provider, available: true })),
      }),
      listModels: async (provider: string) => ({ models: [{ id: `${provider}-default`, isDefault: true }] }),
    },
    agents: {
      list: async (request?: { filter?: { labels?: Record<string, string>; includeArchived?: boolean } }) => {
        const labels = request?.filter?.labels ?? {};
        const entries = agents
          .filter((agent) => request?.filter?.includeArchived || !agent.archivedAt)
          .filter((agent) => Object.entries(labels).every(([key, value]) => agent.labels[key] === value))
          .map((agent) => ({ agent }));
        return { entries, pageInfo: { hasMore: false, nextCursor: null } };
      },
      ref: (agent: string) => agentHandle(agent),
    },
    workspaces: {
      // Like Paseo: background workspaces are only listed when asked for.
      list: async (request?: { filter?: { includeBackground?: boolean } }) => ({
        entries: workspaces.filter((entry) => !entry.archivingAt && (!entry.background || request?.filter?.includeBackground)),
        pageInfo: { hasMore: false, nextCursor: null },
      }),
      create: async ({ source, title, background }: { source: { path: string }; title?: string; background?: boolean }) => {
        const cwd = source.path;
        opened.push(cwd);
        const workspace: FakeWorkspace = {
          background: Boolean(background),
          title: title ?? null,
          id: `ws-${++next}`,
          projectId: `p-${next}`,
          projectDisplayName: path.basename(cwd),
          projectRootPath: cwd,
          workspaceKind: "directory",
          name: path.basename(cwd),
        };
        workspaces.push(workspace);
        return { id: workspace.id };
      },
      ref: (workspaceId: string) => ({
        refresh: async () => workspaces.find((entry) => entry.id === workspaceId) ?? null,
        setTitle: async (title: string) => {
          workspaces.find((entry) => entry.id === workspaceId)!.title = title;
          return { title };
        },
        agents: {
          create: async (request: Record<string, unknown>) => {
            const key = request.idempotencyKey as string | undefined;
            if (key && keys.has(key)) return { id: keys.get(key)! };
            const workspace = workspaces.find((entry) => entry.id === workspaceId)!;
            const config = request.config as { provider: string };
            const agent: FakeAgent = {
              id: `agent-${++next}`,
              provider: config.provider.split("/")[0]!,
              model: config.provider.split("/")[1] ?? null,
              cwd: workspace.workspaceDirectory ?? workspace.projectRootPath,
              workspaceId,
              status: "idle",
              pendingPermissions: [],
              title: (request.title as string) ?? null,
              labels: (request.labels as Record<string, string>) ?? {},
              updatedAt: new Date(Date.now() + next).toISOString(),
            };
            agents.push(agent);
            created.push({ workspaceId, request });
            if (key) keys.set(key, agent.id);
            return { id: agent.id };
          },
        },
      }),
    },
  };
  return { paseo: paseo as unknown as PaseoApi, agents, workspaces, created, opened };
}

const project = (id: string, dir: string, extra: Partial<FakeWorkspace> = {}): FakeWorkspace => ({
  id,
  projectId: `p-${id}`,
  projectDisplayName: path.basename(dir),
  projectRootPath: dir,
  workspaceKind: "directory",
  name: path.basename(dir),
  ...extra,
});

let scratch: string;
beforeEach(async () => {
  scratch = path.join(await mkdtemp(path.join(tmpdir(), "quick-chat-")), "scratch");
});
afterEach(async () => {
  await rm(path.dirname(scratch), { recursive: true, force: true });
});

describe("the chats workspace", () => {
  it("is registered once, even when several callers ask at the same time", async () => {
    const fake = fakePaseo();
    const chats = new Chats(scratch, () => undefined);
    const ids = await Promise.all([chats.openWorkspace(fake.paseo), chats.openWorkspace(fake.paseo), chats.openWorkspace(fake.paseo)]);
    expect(new Set(ids).size).toBe(1);
    expect(fake.opened).toEqual([scratch]);
    // Hidden from the sidebar's project list.
    expect(fake.workspaces.find((entry) => entry.id === ids[0])).toMatchObject({ background: true, title: "Quick chats" });
    expect((await stat(scratch)).isDirectory()).toBe(true);
  });

  it("reuses a hidden workspace for the folder but not a visible one", async () => {
    // A visible one (from an earlier version, or opened by hand) would show up as a project.
    const fake = fakePaseo({ workspaces: [project("ws-visible", scratch), { ...project("ws-hidden", scratch), background: true }] });
    expect(await new Chats(scratch, () => undefined).openWorkspace(fake.paseo)).toBe("ws-hidden");
    expect(fake.opened).toEqual([]);
  });

  it("is set up again when the remembered one was archived", async () => {
    const fake = fakePaseo();
    const chats = new Chats(scratch, () => undefined);
    const first = await chats.openWorkspace(fake.paseo);
    fake.workspaces.find((entry) => entry.id === first)!.archivingAt = new Date().toISOString();
    expect(await chats.openWorkspace(fake.paseo)).not.toBe(first);
  });
});

describe("the no-project note", () => {
  it("is added once to agents in the chats folder, keeping any existing prompt, and nowhere else", () => {
    const chats = new Chats(scratch, () => undefined);
    const once = chats.withSystemPrompt({ cwd: path.join(scratch, "sub"), systemPrompt: "Be brief." })!;
    expect(once.systemPrompt).toMatch(/^Be brief\.\n\n.*isn't attached to any project/s);
    expect(chats.withSystemPrompt(once)).toBeNull();
    expect(chats.withSystemPrompt({ cwd: `${scratch}-other` })).toBeNull();
  });
});

describe("connecting a chat to a project", () => {
  async function setup() {
    const fake = fakePaseo({ workspaces: [project("ws-app", path.join(tmpdir(), "my-app"))] });
    const chats = new Chats(scratch, () => undefined);
    const workspaceId = await chats.openWorkspace(fake.paseo);
    // Started from Paseo's own new-agent tab in the chats workspace.
    fake.agents.push({ id: "chat-1", provider: "claude", model: "claude-default", cwd: scratch, workspaceId, status: "idle", pendingPermissions: [], title: "What is a monad?", labels: {}, updatedAt: new Date().toISOString() });
    return { fake, chats, chat: { agentId: "chat-1", workspaceId } };
  }

  it("starts a copy in the project with the transcript, then archives the chat", async () => {
    const { fake, chats, chat } = await setup();
    const result = await chats.connect(fake.paseo, { agentId: chat.agentId, workspaceId: "ws-app", archiveOriginal: true });
    expect(result.workspaceId).toBe("ws-app");
    const copy = fake.created.find((entry) => entry.workspaceId === "ws-app")!.request;
    expect(copy.prompt).toContain("A monoid in the category of endofunctors.");
    expect(copy.prompt).toContain("my-app");
    expect(copy.labels).toEqual({ [CONNECTED_FROM_LABEL]: chat.agentId });
    expect((copy.config as { systemPrompt?: string }).systemPrompt).toBeUndefined();
    expect(fake.agents.find((agent) => agent.id === chat.agentId)!.archivedAt).toBeTruthy();
  });

  it("starts only one copy for a double click or a retry", async () => {
    const { fake, chats, chat } = await setup();
    const input = { agentId: chat.agentId, workspaceId: "ws-app", archiveOriginal: false };
    const [a, b] = await Promise.all([chats.connect(fake.paseo, input), chats.connect(fake.paseo, input)]);
    const retry = await chats.connect(fake.paseo, input);
    expect(new Set([a.agentId, b.agentId, retry.agentId]).size).toBe(1);
    expect(fake.created.filter((entry) => entry.workspaceId === "ws-app")).toHaveLength(1);
  });

  it("waits for a reply or a permission prompt to finish first", async () => {
    const { fake, chats, chat } = await setup();
    const agent = fake.agents.find((entry) => entry.id === chat.agentId)!;
    agent.status = "running";
    await expect(chats.connect(fake.paseo, { agentId: chat.agentId, workspaceId: "ws-app", archiveOriginal: true })).rejects.toThrow(/still replying/i);
    agent.status = "idle";
    agent.pendingPermissions = [{}];
    await expect(chats.connect(fake.paseo, { agentId: chat.agentId, workspaceId: "ws-app", archiveOriginal: true })).rejects.toThrow(/allow or deny/);
  });

  it("rejects agents that aren't chats, missing projects and the scratch folder itself", async () => {
    const { fake, chats, chat } = await setup();
    const scratchWorkspace = chat.workspaceId;
    fake.agents.push({ ...fake.agents[0]!, id: "other", cwd: path.join(tmpdir(), "my-app") });
    const connect = (agentId: string, workspaceId: string) => chats.connect(fake.paseo, { agentId, workspaceId, archiveOriginal: true });
    await expect(connect("other", "ws-app")).rejects.toThrow(/Only quick chats/);
    await expect(connect("missing", "ws-app")).rejects.toThrow(/no longer exists/);
    await expect(connect(chat.agentId, "ws-gone")).rejects.toThrow(/isn't open/);
    // Hidden, so it is never offered; connecting to it by ID is still refused.
    await expect(connect(chat.agentId, scratchWorkspace)).rejects.toThrow(/real project|isn.t open/);
  });

  it("doesn't offer the scratch folder or archived workspaces as projects", async () => {
    const { fake, chats } = await setup();
    fake.workspaces.push(project("ws-old", "/old", { archivingAt: new Date().toISOString() }));
    expect((await chats.projects(fake.paseo)).map((entry) => entry.workspaceId)).toEqual(["ws-app"]);
  });
});
