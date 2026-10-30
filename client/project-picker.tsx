import type { PluginClientContext } from "@getpaseo/plugin/client";
import { Icon, ScrollView, TextInput, useToast } from "@getpaseo/plugin/client/ui";
import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Platform, Pressable, Text, View } from "react-native";
import { connectChat, findFolders, listProjects, type ProjectChoice } from "../shared/rpc";
import { describe, type Theme } from "./ui";

type Rpc = PluginClientContext["rpc"];

const MAX_SHOWN = 30;
const SEARCH_DELAY_MS = 200;
// Short enough that header, search, list and key hints all fit in the composer popover, which
// otherwise scrolls as a whole and hides the hints.
const LIST_HEIGHT = 260;

interface Row {
  key: string;
  title: string;
  subtitle: string;
  icon: string;
  target: { workspaceId: string } | { directory: string };
}

const baseName = (path: string) => path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || path;
/** Letters and digits only, lower case: spaces, "-", "_" and capitals don't matter. */
const squash = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
const samePath = (a: string, b: string) => a.replace(/[\\/]+$/, "").toLowerCase() === b.replace(/[\\/]+$/, "").toLowerCase();

/**
 * Picks where a chat continues: an open project, or any folder on the host (added as a project
 * first). Laid out like Paseo's own pickers: header with the host, search, rows, key hints.
 */
export function ProjectPicker({
  theme,
  rpc,
  agentId,
  hostLabel,
  compact,
  onCancel,
  onConnected,
  maxShown = MAX_SHOWN,
}: {
  theme: Theme;
  rpc: Rpc;
  agentId: string;
  hostLabel?: string;
  compact?: boolean;
  onCancel?(): void;
  onConnected(agentId: string): void;
  maxShown?: number;
}) {
  const colors = theme.colors;
  const toast = useToast();
  const [projects, setProjects] = useState<ProjectChoice[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [folders, setFolders] = useState<{ query: string; rows: Row[]; error: string | null } | null>(null);
  const [highlight, setHighlight] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const input = useRef<{ focus(): void; isFocused?(): boolean } | null>(null);

  // The popover moves focus to itself once it has opened (after its animation), so autoFocus, or one
  // early focus(), loses. Keep focusing the search until it holds, for up to a second, so arrow keys
  // reach it instead of moving focus between the popover's buttons.
  useEffect(() => {
    if (compact) return;
    let tries = 0;
    let held = 0;
    const timer = setInterval(() => {
      const field = input.current;
      tries += 1;
      if (field?.isFocused?.()) held += 1;
      else {
        held = 0;
        field?.focus();
      }
      if (held >= 3 || tries >= 20) clearInterval(timer);
    }, 50);
    return () => clearInterval(timer);
  }, [compact]);

  useEffect(() => {
    let live = true;
    rpc(listProjects, {}).then(
      (result) => live && setProjects(result.projects),
      (failure: unknown) => live && setError(describe(failure)),
    );
    return () => {
      live = false;
    };
  }, [rpc]);

  // Folder search runs on the host, a moment after typing stops.
  const needle = query.trim();
  useEffect(() => {
    if (!needle) return setFolders(null);
    let live = true;
    const timer = setTimeout(() => {
      rpc(findFolders, { query: needle }).then(
        (result) =>
          live &&
          setFolders({
            query: needle,
            error: result.error,
            rows: result.folders.map((folder) => ({
              key: `dir:${folder.directory}`,
              title: baseName(folder.directory),
              subtitle: folder.shortDirectory,
              icon: "Folder",
              target: { directory: folder.directory },
            })),
          }),
        (failure: unknown) => live && setFolders({ query: needle, rows: [], error: describe(failure) }),
      );
    }, SEARCH_DELAY_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [rpc, needle]);

  const { projectRows, folderRows } = useMemo(() => {
    // As the folder search does: "rename me" finds rename-me-test, renameMe and rename_me.
    const lower = squash(needle);
    const matching = (projects ?? []).filter((p) => !lower || squash(p.label).includes(lower) || squash(p.directory).includes(lower));
    const projectRows: Row[] = matching.slice(0, maxShown).map((p) => ({
      key: p.workspaceId,
      title: p.label,
      subtitle: p.shortDirectory,
      icon: p.worktree ? "GitBranch" : "FolderOpen",
      target: { workspaceId: p.workspaceId },
    }));
    // Folders that are already open projects are listed once, as the project.
    const open = projects ?? [];
    const folderRows = (folders?.rows ?? []).filter(
      (row) => "directory" in row.target && !open.some((p) => samePath(p.directory, (row.target as { directory: string }).directory)),
    );
    return { projectRows, folderRows };
  }, [projects, folders, needle, maxShown]);

  const rows = [...projectRows, ...folderRows];
  useEffect(() => setHighlight(0), [needle]);

  const connect = async (row: Row) => {
    if (busy) return;
    setBusy(row.key);
    try {
      const result = await rpc(connectChat, { agentId, ...row.target });
      onConnected(result.agentId);
    } catch (failure) {
      toast.show(describe(failure), { variant: "error" });
      setBusy(null);
    }
  };

  // The list scrolls on its own, so the row picked with the arrow keys can be kept in view.
  const list = useRef<{ scrollTo(options: { y: number; animated?: boolean }): void } | null>(null);
  const rowFrames = useRef(new Map<number, { y: number; height: number }>());
  const scrollY = useRef(0);
  const viewHeight = useRef(LIST_HEIGHT);
  useEffect(() => {
    const frame = rowFrames.current.get(highlight);
    if (!frame) return;
    // The section label above the first row of each group comes along when scrolling up.
    const top = frame.y - 24;
    const bottom = frame.y + frame.height;
    if (top < scrollY.current) list.current?.scrollTo({ y: Math.max(0, top), animated: false });
    else if (bottom > scrollY.current + viewHeight.current) list.current?.scrollTo({ y: bottom - viewHeight.current, animated: false });
  }, [highlight]);

  const onKey = (event: { nativeEvent: { key: string }; preventDefault?(): void; stopPropagation?(): void }) => {
    const key = event.nativeEvent.key;
    if (key === "ArrowDown" || key === "ArrowUp") {
      event.preventDefault?.();
      event.stopPropagation?.();
      if (rows.length) setHighlight((at) => (at + (key === "ArrowDown" ? 1 : rows.length - 1)) % rows.length);
    } else if (key === "Enter") {
      const row = rows[highlight];
      if (row) void connect(row);
    } else if (key === "Escape") onCancel?.();
  };

  const divider = { height: 1, backgroundColor: colors.border };
  const muted = { color: colors.foregroundMuted, fontSize: 12 };
  const showHints = Platform.OS === "web" && !compact;

  const section = (label: string) => (
    <Text style={{ ...muted, fontSize: 11, fontWeight: "600", paddingHorizontal: 14, paddingTop: 8, paddingBottom: 4 }}>{label}</Text>
  );

  const renderRow = (row: Row, index: number) => {
    const active = index === highlight;
    return (
      <Pressable
        key={row.key}
        accessibilityRole="button"
        accessibilityLabel={`Continue in ${row.title}`}
        accessibilityHint="A new agent there continues this chat"
        disabled={busy !== null}
        onPress={() => void connect(row)}
        onHoverIn={() => setHighlight(index)}
        onLayout={(event) => rowFrames.current.set(index, event.nativeEvent.layout)}
        style={({ pressed }) => ({
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
          paddingHorizontal: 14,
          paddingVertical: 8,
          backgroundColor: active || pressed ? colors.surface2 : "transparent",
          opacity: busy && busy !== row.key ? 0.5 : 1,
        })}
      >
        <Icon name={row.icon} size={16} color={colors.foregroundMuted} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ color: colors.foreground, fontSize: 14 }} numberOfLines={1}>
            {row.title}
          </Text>
          <Text style={muted} numberOfLines={1}>
            {row.subtitle}
          </Text>
        </View>
        {busy === row.key ? <ActivityIndicator size="small" color={colors.foregroundMuted} /> : null}
      </Pressable>
    );
  };

  const hint = (keys: string, label: string) => (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
      <View style={{ backgroundColor: colors.surface2, borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1 }}>
        <Text style={{ color: colors.foreground, fontSize: 11 }}>{keys}</Text>
      </View>
      <Text style={muted}>{label}</Text>
    </View>
  );

  let body;
  if (error) body = <Text style={{ color: colors.statusDanger, fontSize: 13, padding: 14 }}>Couldn't list projects: {error}</Text>;
  else if (projects === null) body = <Text style={{ ...muted, padding: 14 }}>Loading projects…</Text>;
  else
    body = (
      <ScrollView
        ref={list as never}
        style={{ maxHeight: LIST_HEIGHT }}
        contentContainerStyle={{ paddingVertical: 4 }}
        keyboardShouldPersistTaps="handled"
        scrollEventThrottle={16}
        onScroll={(event) => (scrollY.current = event.nativeEvent.contentOffset.y)}
        onLayout={(event) => (viewHeight.current = event.nativeEvent.layout.height)}
      >
        {projectRows.length ? section("Projects") : null}
        {projectRows.map((row, i) => renderRow(row, i))}
        {folderRows.length ? section(`Folders on ${hostLabel ?? "this host"}`) : null}
        {folderRows.map((row, i) => renderRow(row, projectRows.length + i))}
        {rows.length === 0 ? (
          <Text style={{ ...muted, fontSize: 13, paddingHorizontal: 14, paddingVertical: 10 }}>
            {!needle
              ? "No projects yet. Search for a folder."
              : folders?.query !== needle
                ? "Searching…"
                : folders.error
                  ? `No project matches. Folder search isn't available: ${folders.error}`
                  : `Nothing matches “${needle}”.`}
          </Text>
        ) : null}
      </ScrollView>
    );

  return (
    <View>
      <View style={{ flexDirection: "row", alignItems: "baseline", gap: 8, paddingHorizontal: 14, paddingTop: 4, paddingBottom: 10 }}>
        <Text style={{ color: colors.foreground, fontSize: 13, fontWeight: "600" }}>Connect to project</Text>
        {hostLabel ? <Text style={muted}>{hostLabel}</Text> : null}
      </View>
      <TextInput
        value={query}
        onChangeText={setQuery}
        onKeyPress={onKey}
        onSubmitEditing={() => rows[highlight] && void connect(rows[highlight]!)}
        ref={input as never}
        placeholder="Search projects and folders…"
        placeholderTextColor={colors.foregroundMuted}
        autoCapitalize="none"
        autoCorrect={false}
        accessibilityLabel="Search projects and folders"
        style={{ color: colors.foreground, fontSize: 14, paddingHorizontal: 14, paddingVertical: 10, borderTopWidth: 1, borderColor: colors.border, outlineStyle: "none" } as never}
      />
      <View style={divider} />
      {body}
      {showHints ? (
        <>
          <View style={divider} />
          <View style={{ flexDirection: "row", gap: 16, paddingHorizontal: 14, paddingVertical: 8 }}>
            {hint("↑↓", "Navigate")}
            {hint("↵", "Connect")}
            {onCancel ? hint("Esc", "Close") : null}
          </View>
        </>
      ) : null}
    </View>
  );
}
