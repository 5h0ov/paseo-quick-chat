import type { AgentTimelineItem } from "@getpaseo/protocol/agent-types";

export type { AgentTimelineItem };

type ToolCall = Extract<AgentTimelineItem, { type: "tool_call" }>;

/** Transcripts longer than this keep the chat's first message and its most recent part. */
const TRANSCRIPT_LIMIT = 40_000;
/** How much of that first message is kept. */
const FIRST_MESSAGE_LIMIT = 6_000;

const CHAT_START = "<earlier-chat>";
const CHAT_END = "</earlier-chat>";
const GAP = "\n\n";

/** Trimmed, and cut to `limit` characters with an ellipsis when longer. */
function shorten(text: string, limit: number): string {
  const value = text.trim();
  if (value.length <= limit) return value;
  return value.slice(0, limit) + "…";
}

/** The chat is quoted between CHAT_START and CHAT_END; a message containing either is reworded. */
function escapeMarkers(text: string): string {
  return text.split(CHAT_START).join("[earlier chat:").split(CHAT_END).join("]");
}

/** One line per tool call, without its output. */
function toolLine(call: ToolCall): string {
  const { detail } = call;
  if (detail.type === "shell") return "[ran `" + shorten(detail.command, 200) + "`]";
  if (detail.type === "read") return "[read " + detail.filePath + "]";
  if (detail.type === "write" || detail.type === "edit") return "[wrote " + detail.filePath + " in the scratch folder]";
  if (detail.type === "search") return "[searched: " + shorten(detail.query, 120) + "]";
  return "[" + call.name + "]";
}

/** The transcript line for a timeline item, or null for what isn't carried over (reasoning, empty replies). */
function lineFor(item: AgentTimelineItem): string | null {
  switch (item.type) {
    case "user_message":
      return "User: " + escapeMarkers(item.text).trim();
    case "assistant_message":
      return item.text.trim() ? "Assistant: " + escapeMarkers(item.text).trim() : null;
    case "tool_call":
      return toolLine(item);
    default:
      return null;
  }
}

/**
 * The conversation as plain text, oldest first: messages and one line per tool call. When it's
 * longer than `limit`, the newest part is kept, starting at a whole entry, after the chat's first
 * message.
 */
export function buildTranscript(timeline: readonly AgentTimelineItem[], limit = TRANSCRIPT_LIMIT): string {
  const entries = timeline.map(lineFor).filter((line): line is string => line !== null);
  const full = entries.join(GAP);
  if (full.length <= limit) return full;

  const opening = timeline.find((item) => item.type === "user_message");
  const lead = opening ? "User (first message): " + shorten(escapeMarkers(opening.text), FIRST_MESSAGE_LIMIT) + GAP : "";
  let recent = full.slice(-limit);
  const boundary = recent.indexOf(GAP);
  if (boundary >= 0) recent = recent.slice(boundary + GAP.length);
  return lead + "[… earlier messages omitted …]" + GAP + recent;
}

/** The first message of the agent that continues a chat in a project. */
export function connectPrompt(transcript: string, projectDirectory: string): string {
  const chat = transcript || "(The chat had no messages yet.)";
  return `This conversation started as a general chat with no project. The user has now connected it to the project in
${projectDirectory}, which is your working directory. Here is the chat so far, oldest first:

${CHAT_START}
${chat}
${CHAT_END}

Files the chat mentions writing were in a separate scratch folder, not in this project.
Carry on from where the chat left off. Look at the project before changing anything, and reply briefly to confirm you have the context.`;
}
