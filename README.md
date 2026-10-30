# Quick Chat

Talk to an agent in [Paseo](https://paseo.sh) without picking a project first, and connect the chat to a project later if it turns into real work.

- **Chat right away.** Click **Quick chats** in the sidebar and you're in Paseo's own new-chat tab, with its usual provider and model picker. No folder to choose.
- **All your chats in one place.** They're the agents in the **Quick chats** workspace, listed in the sidebar like any other.
- **Connect to a project later.** A **Connect to project** button in each chat's message box (or **Connect this chat to a project** in the command center, Ctrl+K / ⌘K) carries the conversation over to an agent in the project you pick. Search your open projects, or any folder on the computer, on any drive.
- **Works on your phone.** Everything works from Paseo's mobile app too.

## Install

Requirements:

- Paseo 0.13 or later, with plugins enabled (**Settings → Plugins → Enable plugins**).
- At least one agent provider (Claude Code, Codex, OpenCode, …) installed where the daemon runs.

In the app, open **Settings → Plugins**, paste `npm:@5h0ov/paseo-quick-chat` as the plugin source, and install. Or, on the daemon host:

```bash
paseo plugin install npm:@5h0ov/paseo-quick-chat
# or straight from GitHub:
paseo plugin install github:5h0ov/paseo-quick-chat
```

Then open **Quick chats** in the sidebar.

## Use it

1. Click **Quick chats** in the sidebar, or **New quick chat** in the command center (Ctrl+K / ⌘K). The first time, this sets up the **Quick chats** workspace.
2. Start a chat in Paseo's new-chat tab as usual.
3. When a chat turns into work on a codebase, press **Connect to project** in its message box and pick a project, or search for a folder (it's added as a project). Arrow keys and Enter work too. A new agent starts there with the conversation so far, and you're taken to it.

**Open Preferences** (Settings → Plugins → quick-chat → ⋯):

- **Archive chats once connected** (on by default).
- **Tell chats there's no project**, so they answer directly instead of looking for code (on by default).

## How it works

Every Paseo agent runs in a folder, so quick chats run in a scratch folder, `~/.paseo/quick-chat`, registered once as a workspace called **Quick chats**. Any agent started there counts as a quick chat, and gets a short system prompt saying there's no project (added by an `agent.create` hook, whichever provider you pick).

An agent can't change folders, so connecting a chat starts a new agent in the project instead. Its first message is the chat's transcript: your messages and the replies, plus one line per tool call. A long chat keeps its first message and its most recent part. The new agent starts in the provider's default mode, not the chat's, so the project gets its usual permission prompts.

## Privacy and safety

- Nothing leaves your machine except what your agent provider already sends. Quick Chat keeps no data of its own beyond the scratch folder and a label on agents it creates in projects (`quick-chat.connected-from`). Folder search lists folder names on the daemon host in memory, for the picker only; nothing is saved or sent.
- Connecting a chat never changes files in the project. The new agent only acts on what you ask next.

## Limitations

- The new agent in the project gets the chat as text, not the original session: tool output and reasoning aren't carried over.
- Files a chat wrote are in the scratch folder, not in the project. The hand-off message says so.
- Tested on Windows with Paseo 0.13.

## Development

```bash
git clone https://github.com/5h0ov/paseo-quick-chat.git
cd paseo-quick-chat
bun install
paseo plugin install "$(pwd)"   # run the working copy

bun run typecheck   # client and server, separately
bun run test        # chats, connecting, client bundle and mobile checks
paseo plugin reload quick-chat
paseo plugin logs quick-chat
```

Code layout:

- `client/`: React Native UI (opening the workspace, project picker, composer pill, settings).
- `server/`: chat creation, the scratch workspace, connecting chats to projects, folder search (`folders.ts`).
- `shared/`: RPC contracts.

See [CONTRIBUTING.md](CONTRIBUTING.md). Report problems at [github.com/5h0ov/paseo-quick-chat/issues](https://github.com/5h0ov/paseo-quick-chat/issues).

## Uninstall

```bash
paseo plugin remove quick-chat
```

Your chats stay in Paseo under the **Quick chats** workspace; archive it if you don't want them. The scratch folder is `~/.paseo/quick-chat`.

## Compatibility with other plugins

Quick chats live in a hidden (background) workspace, which keeps the scratch folder out of the sidebar's project list. Paseo leaves agents in hidden workspaces out of the agent lists plugins get unless a plugin asks for them, so plugins that don't can miss quick chats. Known cases, updated as more are found:

| Plugin | What happens in quick chats | Workaround |
| --- | --- | --- |
| [ZeroSub](https://github.com/kapybara-org/zerosub) | The account pill in the message box doesn't show, so you can't switch account from a quick chat. Account routing still works: chats use your default account and switch when it hits a limit. | Switch accounts from a project chat or the Accounts screen. |

Found another? [Open an issue](https://github.com/5h0ov/paseo-quick-chat/issues).
