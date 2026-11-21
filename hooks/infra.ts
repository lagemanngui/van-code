// Infra guard: a shell command that changes live infrastructure, judged per segment.
// 'preview' is a dry run that makes later changes of that family safe; 'change' needs one first;
// 'destroy' has no preview and is refused once on its own.
export type InfraVerdict = { family: string; kind: 'preview' | 'change' | 'destroy'; hint: string }

const KUBE_CHANGE = new Set(['apply', 'create', 'replace', 'patch', 'scale', 'set', 'edit', 'rollout', 'drain', 'cordon', 'taint', 'label', 'annotate'])
const HELM_CHANGE = new Set(['install', 'upgrade', 'rollback'])
const CLOUD_DELETE = /^(delete|terminate|remove|rm|rb|destroy|purge|deregister)(-|$)/

// shortcut: whitespace tokens, so quoted arguments with spaces split wrongly; fine for verbs and flags.
function judge(tokens: string[]): InfraVerdict | undefined {
  const i = tokens.findIndex(t => /^(terraform|tofu|terragrunt|kubectl|helm|aws|gcloud|az|gsutil|pulumi)$/.test(t.slice(t.lastIndexOf('/') + 1)))
  if (i === -1) return undefined
  const bin = tokens[i]!.slice(tokens[i]!.lastIndexOf('/') + 1)
  const rest = tokens.slice(i + 1)
  const args = rest.filter(t => !t.startsWith('-'))
  const isDry = rest.some(t => t.startsWith('--dry-run') || t === '--preview')

  if (bin === 'terraform' || bin === 'tofu' || bin === 'terragrunt') {
    const verb = args[0]
    if (verb === 'plan') return { family: 'terraform', kind: 'preview', hint: '' }
    if (verb === 'destroy' || (verb === 'apply' && rest.includes('-destroy')))
      return { family: 'terraform', kind: 'destroy', hint: `\`${bin} plan -destroy\` shows what it removes` }
    // apply of a saved plan file applies exactly what was reviewed
    if (verb === 'apply' && args.length < 2) return { family: 'terraform', kind: 'change', hint: `\`${bin} plan -out=tfplan\`, then \`${bin} apply tfplan\`` }
    return undefined
  }
  if (bin === 'kubectl') {
    const verb = args.find(a => a === 'diff' || a === 'delete' || KUBE_CHANGE.has(a))
    if (!verb) return undefined
    if (verb === 'diff' || isDry) return { family: 'kubectl', kind: 'preview', hint: '' }
    if (verb === 'delete') return { family: 'kubectl', kind: 'destroy', hint: '`kubectl get` the exact objects first, or add `--dry-run=server`' }
    return { family: 'kubectl', kind: 'change', hint: '`kubectl diff -f ...` or the same command with `--dry-run=server`' }
  }
  if (bin === 'helm') {
    const verb = args[0]
    if (verb === 'template' || verb === 'diff' || (verb && HELM_CHANGE.has(verb) && isDry)) return { family: 'helm', kind: 'preview', hint: '' }
    if (verb === 'uninstall' || verb === 'delete') return { family: 'helm', kind: 'destroy', hint: '`helm status` and `helm get manifest` the release first' }
    if (verb && HELM_CHANGE.has(verb)) return { family: 'helm', kind: 'change', hint: 'the same command with `--dry-run=server`, or `helm diff upgrade` if installed' }
    return undefined
  }
  if (bin === 'pulumi') {
    if (args[0] === 'preview') return { family: 'pulumi', kind: 'preview', hint: '' }
    if (args[0] === 'destroy') return { family: 'pulumi', kind: 'destroy', hint: '`pulumi preview --diff`' }
    if (args[0] === 'up' && !rest.includes('--preview-only')) return { family: 'pulumi', kind: 'change', hint: '`pulumi preview --diff`' }
    return undefined
  }
  // aws, gcloud, az, gsutil: deletes have no dry run worth trusting
  const isSyncDelete = bin === 'aws' && args[1] === 'sync' && rest.includes('--delete')
  if ((isSyncDelete || args.some(a => CLOUD_DELETE.test(a))) && !isDry)
    return { family: bin, kind: 'destroy', hint: 'list or describe the exact resources first (`--dryrun` for `aws s3`)' }
  return undefined
}

// The families whose earlier preview an edit of `file` makes stale: it no longer shows what would change.
export function staleFamilies(file: string): string[] {
  if (/\.(tf|tfvars|hcl)$/.test(file)) return ['terraform']
  if (/\.(ya?ml|tpl)$/.test(file)) return ['kubectl', 'helm']
  if (/\.(ts|js|py|go|cs|java)$/.test(file)) return ['pulumi'] // Pulumi programs are code
  return []
}

// Every infra segment of a shell command, in order; `cd x &&`, pipes and `rtk` prefixes are seen through.
export function judgeInfra(command: string): InfraVerdict[] {
  return command
    .split(/&&|\|\||[;|\n]/)
    .map(s => judge(s.trim().split(/\s+/).filter(Boolean)))
    .filter((v): v is InfraVerdict => v !== undefined)
}
