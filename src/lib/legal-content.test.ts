import { describe, expect, it } from 'vitest'
import { inlineSegments, parseLegalContent } from './legal-content'

describe('documentos legales', () => {
  it('separa títulos, párrafos y listas', () => {
    const blocks = parseLegalContent('**BORRADOR**\n\n## 1. Uno\n\nTexto que\nsigue.\n\n- a\n- b\n\n## 2. Dos')
    expect(blocks).toEqual([
      { type: 'paragraph', text: '**BORRADOR**' },
      { type: 'heading', text: '1. Uno' },
      { type: 'paragraph', text: 'Texto que sigue.' },
      { type: 'list', items: ['a', 'b'] },
      { type: 'heading', text: '2. Dos' },
    ])
  })

  it('negrita en línea, sin interpretar HTML', () => {
    expect(inlineSegments('Hola **mundo** <b>x</b>')).toEqual([
      { text: 'Hola ', bold: false },
      { text: 'mundo', bold: true },
      { text: ' <b>x</b>', bold: false },
    ])
  })
})
