<img width="1334" height="502" alt="image" src="https://github.com/user-attachments/assets/d54be0a3-0f5a-4886-a5ec-bb542eae703d" />

A Claude Code mod for coding that is **assertive, economical and straight to the point**.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install van-code --marketplace lagemanngui/van-code
```

Answer `y` to add the marketplace, then press Enter to pick the user scope. The mod is active right away and in every session after.

From a shell:

```
claude plugin install van-code --marketplace lagemanngui/van-code
```

In the desktop app, where `/plugin` does not run: click **+** next to the prompt box, then **Plugins**, **Add marketplace** with `lagemanngui/van-code`, then **Add plugin**.

After installing, run `/van-code-setup` once to install the recommended tools (see [Factory equipment](#factory-equipment)).

## Commands

| Command | What it does |
|---|---|
| `/van-code` | Replays the intro and re-checks the factory equipment |
| `/van-code-setup [items]` | Installs the missing recommended tools; with names, also optional ones (`/van-code-setup context7`). Reloads plugins, or restarts the session, when done |
| `/van-code-stats` | Session scoreboard: what the mod saved and what its Haiku calls cost (estimates) |
| `/van-code-guard` | Turns the heavy-file guard off or on for this session |
| `/chong-li` | Adversarial review: Chong Li tries to find one concrete way the latest changes break |

## What it does on its own

### Economy

- **Heavy-file guard.** Lockfiles, `node_modules`, `dist`, `.next`, `coverage`, `vendor`, `.git`, `.min.js/.css` and `.map` files can only be read in slices of up to 300 lines. Claude is told to Grep first.
- **Read memory.** Re-reading a file that has not changed is refused once, with "use what you already read". Asking again goes through. Reset after `/compact`. Tracked per agent.
- **Context alarm.** A notice when context passes 60%, suggesting `/compact` or `/clear`.
- **Usage header.** Above the prompt: the model, the rate-limit bars (5h, 7d) with the time until they reset, and the context. A comet sweeps across while Claude works.

### Assertiveness

- **Post-edit check.** Right after every edit, the language's own checker runs on that file (`tsc` from the project, `ruff` or `py_compile`, `go vet`, `bash -n`). Errors ride back on the edit's result so Claude fixes them before moving on. Zero tokens when clean.
- **Prove it works.** If Claude edits code and the turn ends with no test, build or type-check, it is asked to verify on your next message, with the list of tests that cover the change.
- **Affected tests.** The `affected_tests` tool follows imports (via `git grep`, up to 4 levels) from a changed file to the tests that reach it, so Claude runs 3 tests instead of 300. Works for TypeScript/JavaScript, Python and Go.
- **Assumption ledger.** On a non-trivial task, the `assumptions` tool records what the plan rests on and the cheapest proof for each item, before any code is written. The ledger shows live above the prompt. Saying "done" with open assumptions gets flagged.
- **Automatic Chong Li.** Changes over 30 lines, or in risky areas (data deletion, migrations, auth, money, concurrency, parsing, SQL), get a cheap review by Haiku, which sees only the diff and must name one concrete failing scenario or nothing. Findings reach Claude on your next message, flagged as possibly wrong.
- **Van Code rules.** Short instructions added to Claude's system prompt: verify before claiming, read only what is needed, lead with the answer, test before saying done.

### Flow

- **Reply suggestions.** After each answer, if Claude Code shows no suggestion within 4 seconds, the mod proposes your likely next message (Tab takes it). It never suggests a slash command or repeats what you just sent.

## Factory equipment

On start, the mod checks these and lists them above the prompt. `/van-code-setup` installs what is missing.

| Item | What it is | Installed with |
|---|---|---|
| `rtk` | Trims command output to save tokens | `brew install rtk`, `rtk init -g --auto-patch` |
| `ponytail` | Lazy senior dev mode: the smallest change that works | `claude plugin install ponytail@ponytail` |
| `config` | Caps huge outputs: `BASH_MAX_OUTPUT_LENGTH=15000`, `MAX_MCP_OUTPUT_TOKENS=10000` | Written to `~/.claude/settings.json`, only where unset |
| `lsp` | IDE-style code navigation for the project's language (TypeScript, Python, Rust, Go) | The official LSP plugin and its language server (`npm` or `brew`) |
| `commit-commands` | `/commit` and `/commit-push-pr` | The official plugin |
| `context7` *(optional)* | Up-to-date library docs (external service) | The official plugin |
| `security-guidance` *(optional)* | Security review; spends tokens every turn | The official plugin |

Installing needs Homebrew (for `rtk` and some language servers), `npm` (for the TypeScript and Python language servers) and GitHub access.

## Settings

Every automatic behavior has a switch in the plugin's settings (`/config`), all on by default:

| Key | Behavior |
|---|---|
| `intro` | Intro animation |
| `guard` | Heavy-file guard |
| `readMemory` | Read memory |
| `postEditCheck` | Post-edit check |
| `proveIt` | Prove it works |
| `chongLi` | Automatic Chong Li (`/chong-li` always works) |
| `suggestions` | Reply suggestions |
| `contextAlarm` | Context alarm |
| `rules` | Van Code rules |
| `usageHeader` | Usage header |

## Cost

Everything runs locally and costs no tokens, except two features that call Haiku: Chong Li (only on big or risky changes) and reply suggestions (only when Claude Code shows none). Their cost counts in the session total and shows in `/van-code-stats`.

## Development

Run the tests:

```
claude plugin test <path-to-this-folder>
```

To load a working copy instead of the installed plugin, add its folder to `CLAUDE_CODE_PLUGIN_DIRS` in the `env` block of `~/.claude/settings.json`, and do not install the marketplace copy at the same time.

| File | Contents |
|---|---|
| `hooks/register.tsx` | The hooks: guards, checks, reviews, suggestions and the band above the prompt |
| `hooks/intro.ts` | The pixel-art intro |
| `hooks/factory.ts` | Factory equipment: checks and installs |
| `hooks/checks.ts` | Post-edit checkers and the affected-tests search |
| `hooks/usage.ts` | The usage header |

## License

MIT
