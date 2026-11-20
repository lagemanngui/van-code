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
| `/van-code-stats` | Session scoreboard: what the mod saved and what its Haiku calls cost (estimates), whether each guard is on, what the last request cost (tool calls, model requests, time, share of input from cache), the session's input split into uncached, cache read and cache write, and the average cost per request |
| `/van-code-guard` | Turns the heavy-file guard off or on for this session |
| `/van-code-scan [refresh \| install <n>...]` | Stack scan: finds what your dependencies' owners publish for AI agents (see [Stack scan](#stack-scan)). `install 1 3` installs those items of the list; `refresh` scans again instead of showing the saved result |
| `/chong-li` | Adversarial review: Chong Li tries to find one concrete way the latest changes break |

## What it does on its own

### Economy

- **Heavy-file guard.** Lockfiles, `node_modules`, `dist`, `.next`, `coverage`, `vendor`, `.git`, `.min.js/.css` and `.map` files can only be read in slices of up to 300 lines, by Read or by the shell (`cat`, `less`, `bat`, `git show rev:path` are blocked, `head -n`/`sed -n 'A,Bp'` slices pass; `rtk bypass` and `cd x &&` prefixes are seen through). Claude is told to Grep first.
- **Read memory.** Re-reading lines of a file that has not changed is refused once, with "use what you already read", including a smaller range inside what was read (1–200, then 50–150) and `cat`/`head`/`sed -n` in the shell (except under `rtk bypass`, which means the first output was unusable). Asking again goes through. Reset after a compaction, checked against the transcript so it holds even when another plugin swallows the compact event. Tracked per agent.
- **Loop detector.** The same shell command failing 3 times in a row tells Claude to stop retrying, read the error and change course.
- **PDFs as text.** With `indra` installed, a Read of a PDF with no page range, or 4 pages or more, is refused once and pointed to `indra-ocr <file> --out <dir>`. Asking again goes through, for when the pages are needed as images (figures, charts, layout). A few pages (`pages: "2-3"`) pass. Read memory tracks PDFs by page.
- **Context alarm.** A notice when context passes 60%, suggesting `/compact` or `/clear`.
- **Usage header.** Above the prompt: the model, the rate-limit bars (5h, 7d) with the time until they reset, and the context. A comet sweeps across while Claude works.

### Assertiveness

- **Post-edit check.** Right after every edit, the language's own checker runs on that file (`tsc` from the project, `ruff` or `py_compile`, `go vet`, `bash -n`). Infra files too, when the tool is installed: `terraform`/`tofu validate` in an initialised folder (`fmt`, which still catches syntax errors, otherwise), `helm lint` on the chart a file belongs to, and `kubeconform` on Kubernetes manifests (a YAML file with `apiVersion` and `kind`). Errors ride back on the edit's result so Claude fixes them before moving on. When the same error comes back after 2 edits of a file (a structural error: a type or signature mismatch, which retrying rarely fixes), Claude is told to stop patching the line and fix it at its source. Zero tokens when clean.
- **Prove it works.** If Claude edits code and the turn ends with no test, build or type-check, it is asked to verify on your next message, with the list of tests that cover the change, or a syntax check to run when no test covers it. When no test reaches the edited files and the post-edit check passed on all of them, that check is the proof and nothing is asked. A run of chosen test files (`vitest run tests/x.test.ts`, `pytest tests/test_x.py`) counts only if one of them reaches the edited code; otherwise Claude is told those tests prove nothing about the change and is given the ones that do. Syntax checks count: `bash -n`, `sh -n`, `shellcheck`, `node --check`, `python -m py_compile`. Reading or committing a test (`cat x.test.ts`, `git commit -m "tests"`) does not.
- **UI check.** In a repo with a web frontend, when Claude changes a user-facing file (`.tsx`, `.jsx`, `.vue`, `.svelte`, `.astro`, `.html`, `.css`) and no browser ran in that turn, it is asked on your next message to walk the flow with `playwright-cli` as a user would, or say in one line why the change needs none. Once per file. Without `playwright-cli`, you get one notice offering `/van-code-setup playwright`. A `playwright` command (or the official Playwright plugin's tools) counts as verification.
- **Affected tests.** The `affected_tests` tool follows imports (via `git grep`, up to 4 levels) from a changed file to the tests that reach it, so Claude runs 3 tests instead of 300. Each file is searched in its own git repository, so changes across sibling repos get each repo's tests. Works for TypeScript/JavaScript, Python and Go.
- **Card plan.** When your message reads as a pasted card (a user story, a bug report or a task card, in Portuguese or English: "critérios de aceite", "steps to reproduce", "como um ... quero", Given/When/Then, or a ticket key like PAY-482 in a structured text), Claude is told, along with the card, to plan before coding. A story: list each acceptance criterion as a target, ask only what is ambiguous in a way that changes what gets built, keep to the story. A bug: reproduce it first (a failing test, or the steps walked in a browser), then fix and show the same reproduction passing. Saying "done" with a target open gets flagged.
- **Assumption ledger.** On a non-trivial task, the `assumptions` tool records what the plan rests on and the cheapest proof for each item, before any code is written. The ledger shows live above the prompt. Saying "done" with open assumptions gets flagged.
- **Targets.** For work across repositories, services or contracts, the ledger also lists every target the change must reach. An edit inside a repository target (an absolute path) marks it done; the others are marked done or n/a by Claude, with a note. Saying "done" with a target still open gets flagged, so the work does not stop at the first green repo.
- **Infra guard.** `terraform`/`tofu apply`, `pulumi up`, and `kubectl`/`helm` changes are held once until a preview of the same tool ran in the session (`plan`, `kubectl diff`, `--dry-run=server`, `helm template`); applying a saved plan file passes. Deletes (`terraform destroy`, `kubectl delete`, `helm uninstall`, `aws`/`gcloud`/`az` delete and terminate, `aws s3 sync --delete`) are refused once, with a reminder to check the target context or account. Running the same command again goes through.
- **No AI attribution.** Claude is told never to credit itself or any AI in commits, PRs, issues, comments or docs. A `git commit`/`tag`/`notes`/`merge` or `gh pr`/`issue`/`release` carrying an AI `Co-Authored-By`, a "Generated with Claude Code" line or `noreply@anthropic.com` is refused every time, until the line is removed.
- **Compaction trim.** Before a compaction, old tool output over 2,000 characters is cut to its first 600, so the summarizer reads decisions, not dumps, and costs less. The newest 12 messages and error outputs stay whole.
- **Compaction restore.** On a compaction the summarizer is told to keep the user's constraints, the repos and services involved, and the reasons behind decisions. Right after it, your own messages from the session (verbatim, the newest 4,000 characters) and the assumption ledger ride back to Claude on the next tool result, or on your next message.
- **Automatic Chong Li.** Changes over 30 lines, or in risky areas (data deletion, migrations, auth, money, concurrency, parsing, SQL), get a cheap review by Haiku, which sees only the diff and must name one concrete failing scenario or nothing. It looks hardest at the runtime defects compilers and retries rarely catch: indexes past either end, overflow, unbounded recursion and fragile input parsing. Findings reach Claude on your next message, flagged as possibly wrong.
- **Van Code rules.** Short instructions added to Claude's system prompt: verify before claiming, read only what is needed, lead with the answer, test before saying done.

### Flow

- **Reply suggestions.** After each answer, if Claude Code shows no suggestion within 4 seconds, the mod proposes your likely next message (Tab takes it). It never suggests a slash command or repeats what you just sent.

## Stack scan

`/van-code-scan` looks for official AI resources for the frameworks and libraries you use, then for community ones where there are none. It runs only when you ask, since it uses the network.

1. **Dependencies.** It reads the declared dependencies of each repo (`package.json`, `pyproject.toml`, `requirements.txt`, `go.mod`, `composer.json`, `pubspec.yaml`) and finds each one's repository: from what is installed (`node_modules`, `.venv`, `vendor`, `~/.pub-cache`), else from its registry. The owner of that repository (github.com/nestjs) is the official channel. Owners behind more runtime packages come first; dev tools count half and `@types/*` not at all.
2. **Official.** For the top 15 owners: a plugin of Anthropic's catalog built from their repos, a Claude Code plugin marketplace or a published skills folder in their GitHub org (found with `gh`), and an `llms.txt` on their docs site. MCP repos are listed to look at, not to install.
3. **Community.** For the owners with nothing official, the most installed matching skills on [skills.sh](https://skills.sh), marked "review before installing". Generic package names (under 5 letters) get none, since they match unrelated skills.

The result is a numbered list; nothing installs until you run `/van-code-scan install <n>`. The scan is saved with a hash of each repo's manifests, so running it again with no dependency change shows the saved result at once (it rescans after 7 days, or with `refresh`). On session start the mod compares those hashes, without the network, and says `Dependências novas em <repo>: rode /van-code-scan` when one changed.

Needs `gh` logged in (`gh auth status`) for the GitHub search; without it only the docs sites and the local catalog are checked. Community skills install with `npx skills add ... -y` into the folder Claude runs in.

## Factory equipment

On start, the mod checks these and lists them above the prompt. Run from a folder that holds several repos side by side (not a monorepo), it also looks one level down: each subfolder with a `.git` counts for the language servers and infra checkers it recommends, and `/chong-li` reviews the uncommitted changes of every one of those repos. `/van-code-setup` installs what is missing.

| Item | What it is | Installed with |
|---|---|---|
| `rtk` | Trims command output to save tokens | `brew install rtk`, `rtk init -g --auto-patch` |
| `ponytail` | Lazy senior dev mode: the smallest change that works | `claude plugin install ponytail@ponytail` |
| `config` | Caps huge outputs: `BASH_MAX_OUTPUT_LENGTH=15000`, `MAX_MCP_OUTPUT_TOKENS=10000` | Written to `~/.claude/settings.json`, only where unset |
| `lsp` | IDE-style code navigation for the project's language (TypeScript, Python, Rust, Go) | The official LSP plugin and its language server (`npm` or `brew`) |
| `commit-commands` | `/commit` and `/commit-push-pr` | The official plugin |
| `context7` *(optional)* | Up-to-date library docs (external service) | The official plugin |
| `security-guidance` *(optional)* | Security review; spends tokens every turn | The official plugin |
| `shellcheck` *(optional)* | After each shell script edit, warnings and errors come back to Claude (after `bash -n`) | `brew install shellcheck` |
| `jq` *(optional; ships with macOS)* | A Read or `cat` of a JSON file over 32 KB is refused once and pointed to `jq` | `brew install jq` |
| `ast-grep` *(optional)* | Claude is told to search code by structure (`ast-grep -p 'fetch($$$)' -l ts`) where a regex would be fragile | `brew install ast-grep` |
| `infra` *(optional; offered when the repo tracks Terraform, Helm or Kubernetes files)* | The checkers the post-edit check uses for those files: OpenTofu (`tofu`, standing in for `terraform`, which left Homebrew core), `helm`, `kubeconform` | `brew install` of the ones this repo needs |
| `playwright` *(optional; offered when the folder has a web frontend)* | [Playwright CLI](https://playwright.dev/agent-cli/introduction) by Microsoft and its official `playwright-cli` skill: Claude opens the app in a browser and clicks, fills and screenshots it as a user would. Uses your installed Chrome | `npm install -g @playwright/cli@latest`, then `playwright-cli install --skills` from your home folder, so the skill lands in `~/.claude/skills` for every project |
| `kitty` *(optional; macOS and Linux)* | The [kitty](https://github.com/kovidgoyal/kitty) terminal: Claude Code's file links are clickable, images show inline (cmd/ctrl+click an image's name), Shift+Enter makes a new line. On a fresh install you are asked whether to make it the default terminal (macOS: what opens shell scripts and `ssh://` links; Linux: `xdg-terminals.list` and GNOME's setting; not asked on WSL). Writes `~/.config/kitty/kitty.conf` and `open-actions.conf` only where you have none; the `ls` line for clickable names is shown for you to add to your shell's rc file, not written | macOS: `brew install --cask kitty font-jetbrains-mono` and `brew install coreutils` (GNU `ls`). Linux or no Homebrew: kitty's official installer, linked into `~/.local/bin` |
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
| `infraGuard` | Infra guard |
| `noAttribution` | No AI attribution |
| `compactRestore` | Compaction restore |
| `compactTrim` | Compaction trim |
| `cardPlan` | Card plan |
| `usageHeader` | Usage header |

## Cost

Everything runs locally and costs no tokens, except two features that call Haiku: Chong Li (only on big or risky changes) and reply suggestions (only when Claude Code shows none). Their cost counts in the session total and shows in `/van-code-stats`. `/van-code-scan` costs no tokens: about 4 GitHub API calls and 25 web requests, a few seconds.

## Development

Run the tests and the type-check:

```
claude plugin test <path-to-this-folder>
npm install && npm run typecheck
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
