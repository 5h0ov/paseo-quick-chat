import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const ProjectChoiceSchema = z.object({
  workspaceId: z.string(),
  /** Project name, then the workspace (branch or worktree) when it isn't the main checkout. */
  label: z.string(),
  directory: z.string(),
  /** The directory as shown: `~/…` under the home folder. */
  shortDirectory: z.string(),
  worktree: z.boolean(),
});
export type ProjectChoice = z.output<typeof ProjectChoiceSchema>;

/** Sets up the Quick chats workspace if needed. Chats are the agents in it. */
export const openChats = defineRpc({
  name: "quick-chat.open",
  input: z.object({}),
  /** The folder chats run in: agents anywhere inside it are quick chats. */
  output: z.object({ workspaceId: z.string(), directory: z.string() }),
});

export const listProjects = defineRpc({
  name: "quick-chat.projects",
  input: z.object({}),
  output: z.object({ projects: z.array(ProjectChoiceSchema) }),
});

/** Folders on the daemon host matching a search, as Paseo's own "Add project" finds them. */
export const findFolders = defineRpc({
  name: "quick-chat.folders",
  input: z.object({ query: z.string() }),
  output: z.object({
    folders: z.array(z.object({ directory: z.string(), shortDirectory: z.string() })),
    /** Set when the search isn't available (a daemon that needs a password, for one). */
    error: z.string().nullable(),
  }),
});

export const connectChat = defineRpc({
  name: "quick-chat.connect",
  input: z.object({
    agentId: z.string(),
    /** An open project's workspace, or `directory` to open a folder as a project first. */
    workspaceId: z.string().optional(),
    directory: z.string().optional(),
    /** Archive the chat once its copy has started in the project. Omitted: the preference decides. */
    archiveOriginal: z.boolean().optional(),
  }),
  output: z.object({ agentId: z.string(), workspaceId: z.string() }),
});
