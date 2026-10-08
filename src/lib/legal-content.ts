// Formato simple de los documentos legales (legal_documents.content):
// "## " título de sección, "- " ítem de lista, párrafos separados por una
// línea en blanco y **negrita** en línea. Sin HTML: se dibuja con React,
// así el contenido nunca puede inyectar código en la página.

export type LegalBlock =
  | { type: 'heading'; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'list'; items: string[] }

export function parseLegalContent(content: string): LegalBlock[] {
  const blocks: LegalBlock[] = []
  for (const chunk of content.replace(/\r\n/g, '\n').split(/\n\s*\n/)) {
    const lines = chunk.split('\n').map((l) => l.trim()).filter(Boolean)
    let paragraph: string[] = []
    const flush = () => {
      if (paragraph.length) blocks.push({ type: 'paragraph', text: paragraph.join(' ') })
      paragraph = []
    }
    for (const line of lines) {
      if (line.startsWith('## ')) {
        flush()
        blocks.push({ type: 'heading', text: line.slice(3).trim() })
      } else if (line.startsWith('- ')) {
        flush()
        const last = blocks.at(-1)
        if (last?.type === 'list') last.items.push(line.slice(2).trim())
        else blocks.push({ type: 'list', items: [line.slice(2).trim()] })
      } else {
        paragraph.push(line)
      }
    }
    flush()
  }
  return blocks
}

// "Texto **destacado** final" → [{text, bold}]
export function inlineSegments(text: string): { text: string; bold: boolean }[] {
  return text
    .split(/(\*\*[^*]+\*\*)/)
    .filter(Boolean)
    .map((part) => (part.startsWith('**') && part.endsWith('**') ? { text: part.slice(2, -2), bold: true } : { text: part, bold: false }))
}
