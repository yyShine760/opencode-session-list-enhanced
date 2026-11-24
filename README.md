# opencode-session-list-enhanced

An enhanced replacement for the built-in OpenCode session list (`<leader>l`, default `ctrl+x l`).
It keeps the same dialog and keys but searches **worktree names and projects**, not only session
titles.

## The problem

`session.list` is backed by this server-side filter:

```ts
if (input.search) conditions.push(sql`${SessionTable.title} GLOB ${titlePattern(input.search)}`)
```

The dialog displays a worktree label on the right, but that label is not searchable. If you work in
several worktrees, sessions under `travel/`, `shopping-explore/` and so on can only be found by their
titles.

## Install

```bash
opencode plugin add github:yyShine760/opencode-session-list-enhanced
```

Or pin it in your global `opencode.json`:

```jsonc
{
  "plugins": ["github:yyShine760/opencode-session-list-enhanced"]
}
```

Restart the TUI once so it loads the plugin's TUI part. After that `<leader>l` opens the new list.

An npm package is not published yet; when it is, `opencode plugin add opencode-session-list-enhanced` will work the same way.

## What it does

- **Scope**: current project, across every worktree. `ctrl+a` switches to all projects.
- **Search**: session title, the worktree label shown on the right, the project name (all-projects
  mode) and the session id. Whitespace-separated terms are ANDed and matching is case-insensitive.
- **Labels**: the worktree path relative to the project root. Sessions in the canonical checkout
  show the checkout's current branch (`main`), or the project name when it is not a git repository.
- **Rows**: title, muted date, worktree label on the right.
- **Actions**: `ctrl+d` delete (press twice), `ctrl+r` rename, `ctrl+a` toggle scope, `enter` open.

Examples:

| query | matches |
| --- | --- |
| `travel` | every session in the `travel` worktree |
| `travel 北海` | sessions in `travel` whose title contains `北海` |
| `main` | sessions in the canonical checkout on branch `main` |

## Not included

- **Pin** (`ctrl+f`): pinned state lives in the host's session UI store, which the plugin API does not
  expose. Porting it would need a separate store that cannot share state with the core list.
- **Quick-switch numbers** in the list: rendering them requires a JSX gutter and the OpenTUI peer
  packages. `<leader>1-9` itself keeps working.
- **Date group headers**: when a dialog supplies a custom `search` callback, the host renders results
  as a flat list, so dates appear inline instead.

## How the keybind works

`cli.json` only accepts built-in keybind ids — plugin-specific ids are stripped before the config is
applied. The plugin therefore registers its **command** with the built-in id `session.list`, so the
existing `<leader>l` binding (including a customised leader) keeps working and the built-in dialog is
replaced. The plugin/package id itself is `yyshine760.session-list-enhanced`; only the command id is
shared with the built-in one.

## Compatibility

Built and tested against OpenCode 2.4.1. It reimplements part of the TUI session list, so a future
release may change the surrounding behaviour. If the plugin fails to load, remove it with
`opencode plugin remove opencode-session-list`.

## Development notes

`@opencode/plugin` is a devDependency only: OpenCode provides the runtime module, so installing the
plugin does not pull its dependencies (fresh installs are about 50 KB instead of ~190 MB).

Two discovery details cost time while building this:

1. A **local plugin directory must not contain `package.json` `name` + `exports`**. Entry-point
   discovery then resolves `<name>/tui` through `node_modules`, which fails for a local path, and the
   plugin is reported with `features: { server: true }` only. Use root files `index.ts` and `tui.ts`
   instead, or install the package normally.
2. `features.tui` is computed once at plugin load. After changing how a plugin is packaged, restart
   the TUI to see the TUI part load.

## License

MIT
