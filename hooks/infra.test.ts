import { expect, test } from 'claude-code/testing'

import { judgeInfra } from './infra.js'

const kinds = (cmd: string) => judgeInfra(cmd).map(v => `${v.family}:${v.kind}`)

test('infra commands are sorted into previews, changes and destroys', () => {
  expect(kinds('terraform plan -out=tfplan')).toEqual(['terraform:preview'])
  expect(kinds('cd infra && terraform -chdir=prod apply -auto-approve')).toEqual(['terraform:change'])
  expect(kinds('terraform apply tfplan')).toEqual([]) // a saved plan was already reviewed
  expect(kinds('tofu destroy')).toEqual(['terraform:destroy'])
  expect(kinds('terraform apply -destroy')).toEqual(['terraform:destroy'])
  expect(kinds('kubectl -n prod apply -f k8s/')).toEqual(['kubectl:change'])
  expect(kinds('kubectl apply -f k8s/ --dry-run=server')).toEqual(['kubectl:preview'])
  expect(kinds('kubectl diff -f k8s/')).toEqual(['kubectl:preview'])
  expect(kinds('kubectl delete pod x')).toEqual(['kubectl:destroy'])
  expect(kinds('kubectl get pods | grep delete')).toEqual([])
  expect(kinds('kubectl logs deploy/api')).toEqual([])
  expect(kinds('helm upgrade api ./chart')).toEqual(['helm:change'])
  expect(kinds('helm upgrade api ./chart --dry-run=server')).toEqual(['helm:preview'])
  expect(kinds('helm uninstall api')).toEqual(['helm:destroy'])
  expect(kinds('aws ec2 terminate-instances --instance-ids i-1')).toEqual(['aws:destroy'])
  expect(kinds('aws s3 sync . s3://b --delete')).toEqual(['aws:destroy'])
  expect(kinds('aws s3 ls')).toEqual([])
  expect(kinds('gcloud compute instances delete vm1')).toEqual(['gcloud:destroy'])
  expect(kinds('pulumi up --yes')).toEqual(['pulumi:change'])
  expect(kinds('rtk terraform plan && terraform apply')).toEqual(['terraform:preview', 'terraform:change'])
  expect(kinds('git commit -m "terraform apply"')).toEqual([])
})

test('a change waits for a preview, a destroy is refused once, insisting goes through', async ($, on) => {
  on('tool.call', () => ({ result: {} }))
  on('ui.toast', () => ({ value: undefined }) as never)
  const bash = (command: string) => $.tool.call({ tool: 'Bash', command } as never)

  expect((await bash('kubectl apply -f a.yaml')).deny).toContain('kubectl diff')
  expect((await bash('kubectl apply -f a.yaml')).deny).toBeUndefined() // asked again
  await bash('helm template api ./chart')
  expect((await bash('helm upgrade api ./chart')).deny).toBeUndefined() // previewed
  expect((await bash('kubectl delete ns x')).deny).toContain('deletes live infrastructure')
})
