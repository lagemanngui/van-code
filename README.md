# Jean-Claude Van Code

A Claude Code mod for coding that is **assertive, economical and straight to the point**.

When Claude starts, a martial artist runs in and lands a flying kick on Clawd. After that the mod works quietly: it guards heavy files, checks every edit, asks for proof before "done", reviews risky changes on the cheap and suggests your next message.

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

- **Heavy-file guard.** Lockfiles, `node_modules`, `dist`, `.next`, `coverage`, `vendor`, `.git`, `.min.js/.css` and `.map` files can only be read in slices of up to 300 lines, by Read or by the shell (`cat`, `less`, `bat`, `git show rev:path` are blocked, `head -n`/`sed -n 'A,Bp'` slices pass; `rtk bypass` and `cd x &&` prefixes are seen through). Claude is told to Grep first.
- **Read memory.** Re-reading lines of a file that has not changed is refused once, with "use what you already read", including a smaller range inside what was read (1–200, then 50–150) and `cat`/`head`/`sed -n` in the shell (except under `rtk bypass`, which means the first output was unusable). Asking again goes through. Reset after a compaction, checked against the transcript so it holds even when another plugin swallows the compact event. Tracked per agent.
- **PDFs as text.** With `indra` installed, a Read of a PDF with no page range, or 4 pages or more, is refused once and pointed to `indra-ocr <file> --out <dir>`. Asking again goes through, for when the pages are needed as images (figures, charts, layout). A few pages (`pages: "2-3"`) pass. Read memory tracks PDFs by page.
- **Context alarm.** A notice when context passes 60%, suggesting `/compact` or `/clear`.
- **Usage header.** Above the prompt: the model, the rate-limit bars (5h, 7d) with the time until they reset, and the context. A comet sweeps across while Claude works.

### Assertiveness

- **Post-edit check.** Right after every edit, the language's own checker runs on that file (`tsc` from the project, `ruff` or `py_compile`, `go vet`, `bash -n`). Errors ride back on the edit's result so Claude fixes them before moving on. Zero tokens when clean.
- **Prove it works.** If Claude edits code and the turn ends with no test, build or type-check, it is asked to verify on your next message, with the list of tests that cover the change, or a syntax check to run when no test covers it. When no test reaches the edited files and the post-edit check passed on all of them, that check is the proof and nothing is asked. Syntax checks count: `bash -n`, `sh -n`, `shellcheck`, `node --check`, `python -m py_compile`.
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
| `indra` *(optional)* | PDFs and scans as text with [Indra OCR](https://github.com/datalab-to/indra), local and free on CPU. Model weights: free for research, personal use and companies under US$20M; larger commercial use needs a Datalab license | `uv tool install --python 3.12 indra-ocr` (or `pipx install indra-ocr`); the first run downloads ~76 MB |

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
