import { access, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Folder search for the project picker. Paseo's own directory search reads the disk on every query
 * (seconds per search on a large disk) and only looks under home, so a project on
 * D:\ never shows. Instead, folders are listed once in the background and searched in memory, and
 * the list is refreshed every few minutes.
 *
 * The walk stops at git repositories (a project's own folders are no project) and skips app data,
 * build output and system folders.
 */

const MAX_DEPTH = 6;
const MAX_FOLDERS = 200_000;
const REFRESH_MS = 10 * 60_000;

// App data, build output and system folders; Windows' legacy junctions repeat AppData twice.
const NOISE = new Set([
  "appdata",
  "application data",
  "local settings",
  "node_modules",
  "saved games",
  "$recycle.bin",
  "system volume information",
  "windows",
  "program files",
  "program files (x86)",
  "programdata",
  "msocache",
  "recovery",
]);

export function isNoise(name: string): boolean {
  return name.startsWith(".") || name.startsWith("$") || NOISE.has(name.toLowerCase());
}

/** Shows paths under the home folder as `~/…`, as Paseo does. */
export function shortPath(path: string, home = homedir()): string {
  const sep = path.includes("\\") ? "\\" : "/";
  if (path.toLowerCase() === home.toLowerCase()) return "~";
  return path.toLowerCase().startsWith((home + sep).toLowerCase()) ? `~${sep}${path.slice(home.length + 1)}` : path;
}

/** Where to look: the home folder, then other drives (Windows) or mounted volumes. */
export async function searchRoots(platform = process.platform, home = homedir()): Promise<string[]> {
  if (platform === "win32") {
    const homeDrive = home.slice(0, 1).toUpperCase();
    const letters = "CDEFGHIJKLMNOPQRSTUVWXYZ".split("").filter((letter) => letter !== homeDrive);
    const found = await Promise.all(letters.map((letter) => access(`${letter}:\\`).then(() => `${letter}:\\`, () => null)));
    return [home, ...found.filter((root): root is string => root !== null)];
  }
  const mounts = platform === "darwin" ? "/Volumes" : "/mnt";
  try {
    const volumes = (await readdir(mounts, { withFileTypes: true })).filter((entry) => entry.isDirectory());
    return [home, ...volumes.map((entry) => join(mounts, entry.name))];
  } catch {
    return [home];
  }
}

/** Every folder under `roots`, breadth first, down to MAX_DEPTH, not inside git repositories. */
export async function listFolders(roots: string[], maxDepth = MAX_DEPTH, max = MAX_FOLDERS): Promise<string[]> {
  const found: string[] = [];
  const seen = new Set<string>();
  let level = roots.map((root) => root);
  for (let depth = 0; depth < maxDepth && level.length && found.length < max; depth += 1) {
    const next: string[] = [];
    await Promise.all(
      level.map(async (dir) => {
        let entries;
        try {
          entries = await readdir(dir, { withFileTypes: true });
        } catch {
          return; // No access, or gone.
        }
        // A repository is a project: list it, but not its own folders.
        if (depth > 0 && entries.some((entry) => entry.name === ".git")) return;
        for (const entry of entries) {
          if (!entry.isDirectory() || isNoise(entry.name)) continue;
          const path = join(dir, entry.name);
          const key = path.toLowerCase();
          if (seen.has(key)) continue;
          seen.add(key);
          found.push(path);
          next.push(path);
        }
      }),
    );
    level = next;
  }
  return found.slice(0, max);
}

/** Letters and digits only, so "photo-editor" finds "Photo Editor" and "PhotoEditor". */
const squash = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
const baseName = (path: string) => path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? path;
const depthOf = (path: string) => path.split(/[\\/]/).filter(Boolean).length;
// Build output repeats project names ("target\debug\build\notes-app-1a2b…"); it goes last.
const BUILD = /[\\/](target|cargo-target|build|dist|out|bin|obj|debug|release|\.?cache)([\\/]|$)/i;

/**
 * Folders whose name contains the search come first: exact names, then names starting with it,
 * then the rest, shallower before deeper. Then folders with the search elsewhere in their path.
 */
export function rank(directories: string[], query: string): string[] {
  const needle = squash(query);
  if (!needle) return [];
  const scored: { path: string; score: number }[] = [];
  for (const path of directories) {
    const name = squash(baseName(path));
    const score = name === needle ? 0 : name.startsWith(needle) ? 1 : name.includes(needle) ? 2 : squash(path).includes(needle) ? 3 : -1;
    if (score >= 0) scored.push({ path, score: score + (BUILD.test(path) ? 4 : 0) });
  }
  return scored.sort((a, b) => a.score - b.score || depthOf(a.path) - depthOf(b.path) || a.path.length - b.path.length).map((entry) => entry.path);
}

export function folderSearch(roots: () => Promise<string[]> = () => searchRoots()) {
  let index: { at: number; folders: Promise<string[]> } | null = null;

  const folders = (): Promise<string[]> => {
    const stale = !index || Date.now() - index.at > REFRESH_MS;
    if (stale) {
      const previous = index?.folders;
      const fresh = roots().then((list) => listFolders(list));
      index = { at: Date.now(), folders: fresh };
      fresh.catch(() => (index = null));
      // While a refresh runs, the previous list answers.
      if (previous) return previous.catch(() => fresh);
    }
    return index!.folders;
  };

  return {
    /** Starts listing folders, so the first search doesn't wait for it. */
    warm(): void {
      void folders().catch(() => undefined);
    },
    async find(query: string, limit = 12): Promise<string[]> {
      if (!squash(query)) return [];
      return rank(await folders(), query).slice(0, limit);
    },
    close(): void {
      index = null;
    },
  };
}
