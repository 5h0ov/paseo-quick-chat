import type { PluginClientContext } from "@getpaseo/plugin/client";
import { openChats } from "../shared/rpc";

export interface ChatsLocation {
  workspaceId: string;
  directory: string;
}

/**
 * The Quick chats workspace and folder, looked up once and shared. A failed lookup isn't
 * remembered, so the next caller tries again.
 */
export function chatsWorkspace(client: Pick<PluginClientContext, "rpc">): () => Promise<ChatsLocation> {
  let pending: Promise<ChatsLocation> | null = null;
  return () => {
    pending ??= client.rpc(openChats, {}).catch((error: unknown) => {
      pending = null;
      throw error;
    });
    return pending;
  };
}

/** Quick chats are the agents anywhere in the chats folder, whichever workspace they're in. */
export function isChat(cwd: string | null | undefined, directory: string): boolean {
  if (!cwd) return false;
  // Paseo runs on Windows too: compare without caring about separators or (there) case.
  const norm = (value: string) => value.replace(/[\\/]+/g, "/").replace(/\/$/, "").toLowerCase();
  const child = norm(cwd);
  const root = norm(directory);
  return child === root || child.startsWith(`${root}/`);
}
