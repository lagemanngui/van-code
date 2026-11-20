// Git guard: commands that throw away uncommitted work, or rewrite the remote's history.
// 'discard' matters only with a dirty tree; 'force' (force push) is refused once on its own.
export type GitVerdict = { kind: 'discard' | 'force'; what: string; dir?: string }

// shortcut: whitespace tokens, so quoted paths with spaces split wrongly; fine for verbs and flags.
function judge(tokens: string[]): GitVerdict | undefined {
  const g = tokens.findIndex(t => t.slice(t.lastIndexOf('/') + 1) === 'git')
  if (g === -1) return undefined
  let rest = tokens.slice(g + 1)
  let dir: string | undefined
  // global options before the verb: `git -C path reset --hard`
  while (rest[0]?.startsWith('-')) {
    if ((rest[0] === '-C' || rest[0] === '-c') && rest[1]) {
      if (rest[0] === '-C') dir = rest[1]
      rest = rest.slice(2)
    } else rest = rest.slice(1)
  }
  const [verb, ...args] = rest
  const has = (...flags: string[]) => args.some(a => flags.includes(a))
  const shortFlag = (c: string) => args.some(a => /^-[a-zA-Z]+$/.test(a) && a.includes(c))
  const d = dir ? { dir } : {}

  if (verb === 'reset' && has('--hard', '--merge', '--keep')) return { kind: 'discard', what: '`git reset --hard` drops every uncommitted change', ...d }
  if (verb === 'checkout' && (args.includes('--') || has('.', '-f', '--force')))
    return { kind: 'discard', what: '`git checkout` over files overwrites their uncommitted changes', ...d }
  if (verb === 'restore' && !(has('--staged', '-S') && !has('--worktree', '-W')))
    return { kind: 'discard', what: '`git restore` overwrites uncommitted changes in the working tree', ...d }
  if (verb === 'switch' && has('-f', '--force', '--discard-changes')) return { kind: 'discard', what: '`git switch --discard-changes` drops uncommitted changes', ...d }
  if (verb === 'clean' && (shortFlag('f') || has('--force')) && !(shortFlag('n') || has('--dry-run')))
    return { kind: 'discard', what: '`git clean -f` deletes untracked files for good', ...d }
  if (verb === 'stash' && (args[0] === 'drop' || args[0] === 'clear')) return { kind: 'discard', what: `\`git stash ${args[0]}\` deletes stashed work`, ...d }
  // --force-with-lease refuses to overwrite commits it has not seen, so it passes
  if (verb === 'push' && (has('--force') || shortFlag('f') || args.some(a => a.startsWith('+'))))
    return { kind: 'force', what: '`git push --force` overwrites the remote branch history', ...d }
  return undefined
}

// The first destructive git segment of a shell command; `cd x &&`, pipes and `rtk` prefixes are seen through.
export function judgeGit(command: string): GitVerdict | undefined {
  for (const s of command.split(/&&|\|\||[;|\n]/)) {
    const v = judge(s.trim().split(/\s+/).filter(Boolean))
    if (v) return v
  }
  return undefined
}
