import { expect, test } from 'claude-code/testing'

import { cardKind, cardNote } from './card.js'

const BUG_PT = `Erro ao finalizar compra com cupom
Passos para reproduzir:
1. Adicionar item ao carrinho
2. Aplicar cupom DESC10
Resultado esperado: desconto de 10%
Resultado obtido: erro 500`

const STORY_PT = `PAY-482 Pagamento com Pix
Como um cliente, eu quero pagar com Pix para concluir a compra mais rápido.
Critérios de aceite:
- QR code exibido no checkout
- Pedido confirmado após o webhook`

const STORY_EN = `As a store admin I want to export orders as CSV.
Acceptance criteria:
- [ ] filter by date`

const GHERKIN = 'Dado que o usuário está logado\nQuando ele clica em sair\nEntão volta para a tela de login'

const TASK = `OPS-77 Migrar filas para o novo cluster

Contexto: as filas de pagamento ainda rodam no cluster antigo e precisam ir para o novo antes do fim do mês.
- mover os consumers de payments e refunds
- atualizar os valores do Helm chart
- remover o cluster antigo do Terraform

Observações: coordenar a janela com o time de plataforma e avisar o suporte antes de começar a migração em produção.`

test('cards are told apart by their markers', () => {
  expect(cardKind(BUG_PT)).toBe('bug')
  expect(cardKind('Steps to reproduce:\n1. open /cart\nExpected behavior: total updates')).toBe('bug')
  expect(cardKind(STORY_PT)).toBe('story')
  expect(cardKind(STORY_EN)).toBe('story')
  expect(cardKind(GHERKIN)).toBe('story')
  expect(cardKind(TASK)).toBe('task')
  // a bug with acceptance criteria is still a bug: reproduce first
  expect(cardKind(`${BUG_PT}\nCritérios de aceite:\n- cupom aplicado`)).toBe('bug')
})

test('chat, commands and pasted logs are not cards', () => {
  expect(cardKind('faz o commit e push')).toBeUndefined()
  expect(cardKind('sim, implementa o 2 e o 3')).toBeUndefined()
  expect(cardKind('Expected: 3\nReceived: 4\n  at sum.test.ts:10')).toBeUndefined() // a test log, not a report
  expect(cardKind('ABC-12 corrige o typo no README')).toBeUndefined() // a ticket key alone, short
  expect(cardKind('x'.repeat(2_000))).toBeUndefined()
})

test('the note fits the kind, and names the browser only when it is installed', () => {
  expect(cardNote('bug', true)).toContain('Reproduce it')
  expect(cardNote('bug', true)).toContain('playwright-cli')
  expect(cardNote('bug', false)).not.toContain('playwright-cli')
  expect(cardNote('story', false)).toContain('acceptance criterion as a target')
  expect(cardNote('task', false)).toContain('what "done" means')
})

test('a pasted card reaches the model with its plan note; plain chat does not', async ($, on) => {
  let context: readonly string[] = []
  on('prompt.submit', (_, e) => {
    context = e.context ?? []
    return { text: e.text }
  })
  on('ui.toast', () => ({ value: undefined }) as never)
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1 }, rateLimits: [] } }) as never)

  await $.prompt.submit({ text: STORY_PT } as never)
  expect(context.join('\n')).toContain('reads as a user story')
  await $.prompt.submit({ text: 'beleza, segue' } as never)
  expect(context.join('\n')).not.toContain('reads as')
  await $.prompt.submit({ text: BUG_PT } as never)
  expect(context.join('\n')).toContain('reads as a bug report')
})
