# Contributing to Quick Chat

Thanks for helping. Issues and pull requests are welcome at [github.com/5h0ov/paseo-quick-chat](https://github.com/5h0ov/paseo-quick-chat).

## Set up

```bash
git clone https://github.com/5h0ov/paseo-quick-chat.git
cd paseo-quick-chat
bun install
paseo plugin install "$(pwd)"   # run your working copy in Paseo
```

After a change: `paseo plugin reload quick-chat`. Logs: `paseo plugin logs quick-chat`.

## Before opening a pull request

```bash
bun run typecheck
bun run test
```

Both must pass. The tests cover chats, connecting to a project, plus two checks that matter for Paseo's phone app:

- **No browser-only code in `client/`** (`client/mobile.test.ts`): the client runs in React Native, so use `View`, `Text`, `Pressable` and the components from `@getpaseo/plugin/client/react-native`, never DOM elements, `window`, `document`, `className` or `onClick`.
- **No class syntax in the client bundle** (`client/bundle.test.ts`): Hermes on the phone can't run classes from Paseo's evaluated bundle. Use closures and plain functions in `client/`. Classes are fine in `server/`, which runs in Node.

Also check your change on a narrow (phone-sized) window: screens use `layout.compact` to stack buttons under titles.

## Code layout

- `client/`: React Native UI.
- `server/`: runs in the Paseo daemon (Node).
- `shared/`: RPC contracts and types used by both.

Side effects on the outside world (the CLI, the file system, git) sit behind small interfaces so the tests can replace them with fakes. Keep it that way: test new behaviour against a fake, and test it once by hand in Paseo.

## Style

- Match the surrounding code: naming, comment density, and the plain-English UI text.
- UI text says what happens and what to do next, without jargon.
- One change per pull request, with a short description of why.

## Publishing

Follow [Publish a plugin](https://paseo.sh/docs/plugins/publishing). In short:

1. **Version.** Bump `version` in `package.json` and add a `CHANGELOG.md` entry.
2. **Listing.** `OVERVIEW.md` is the registry listing page: plain language, where data goes, and no install commands (the validator rejects them). The interface screenshots go in `images/` and in the `media` field of `paseo-plugin.json`.
3. **Check, tag and push.** The [Release workflow](.github/workflows/release.yml) publishes to npm when a `v<version>` tag is pushed, after checking the tag matches `package.json`, typechecking and testing. It can also be run by hand from the Actions tab (**Release → Run workflow**): it publishes the branch's version and adds the tag itself; tick **dry run** to only check.
   ```bash
   bun run typecheck && bun run test
   npm pack --dry-run --ignore-scripts   # paseo-plugin.json, entries, client/ server/ shared/, OVERVIEW.md
   git commit -am "Release v<version>" && git tag v<version>
   git push && git push origin v<version>
   ```
   It uses npm trusted publishing, so no token is stored: the package's settings on npmjs.com list this repository and `release.yml` as its trusted publisher.
4. **Try the published version** on a test daemon (`npm:@5h0ov/paseo-quick-chat@<version>`) and check `paseo plugin ls` shows it `running`, then submit it with the [registry form](https://github.com/getpaseo/plugins/issues/new?template=submit-plugin.yml).

## Reporting a bug

Open an issue with your Paseo version, OS, what you did, what happened, and the output of `paseo plugin logs quick-chat`.
