import type { PluginServerContext, PluginSettingsState } from "@getpaseo/plugin/server";
import { Chats } from "./server/chats";
import { preferences, type Preferences } from "./shared/preferences";
import { folderSearch, shortPath } from "./server/folders";
import { connectChat, findFolders, listProjects, openChats } from "./shared/rpc";

export default function contribute(server: PluginServerContext) {
  const chats = new Chats();
  const folders = folderSearch();

  let current: Preferences = { archiveAfterConnect: true, noProjectNote: true };
  const settings = server.registerSettings(preferences);
  const apply = (state: PluginSettingsState<typeof preferences.schema>) => {
    if (state.status === "ready") current = state.values;
  };
  void settings.read().then(apply, (error: unknown) => console.error("[Quick Chat] could not read preferences", error));
  const stopSettings = settings.subscribe(apply);

  // Chats start in Paseo's own new-agent tab, so the "no project" note is added here, whatever
  // provider or model was picked.
  server.before("agent.create", ({ request }) => {
    if (!current.noProjectNote) return undefined;
    const config = chats.withSystemPrompt(request.config);
    return config ? { ...request, config } : undefined;
  });

  server.handle(openChats, async (_input, { paseo }) => ({ workspaceId: await chats.openWorkspace(paseo), directory: chats.directory }));
  server.handle(listProjects, async (_input, { paseo }) => {
    // The picker is opening: start listing folders, so its first search doesn't wait.
    folders.warm();
    return { projects: await chats.projects(paseo) };
  });
  server.handle(findFolders, async ({ query }) => {
    try {
      const found = await folders.find(query);
      return { folders: found.map((directory) => ({ directory, shortDirectory: shortPath(directory) })), error: null };
    } catch (error) {
      return { folders: [], error: error instanceof Error ? error.message : String(error) };
    }
  });
  server.handle(connectChat, async ({ agentId, workspaceId, directory, archiveOriginal }, { paseo }) => {
    // A folder that isn't a project yet is added as one first, as Paseo's "Add project" does.
    const target = workspaceId ?? (directory ? (await paseo.workspaces.open({ cwd: directory })).id : null);
    if (!target) throw new Error("Pick a project or folder.");
    return chats.connect(paseo, { agentId, workspaceId: target, archiveOriginal: archiveOriginal ?? current.archiveAfterConnect });
  });

  return () => {
    stopSettings();
    folders.close();
  };
}
