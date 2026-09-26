import { z } from 'zod';
import { graphExtractionSchema } from './graph.ts';
import { exactQuote } from './exact-quote.ts';
import type { Block } from './domain';

export function graphExcerpts(blocks: Block[]) {
  return blocks.flatMap((block) => {
    const result: { id: string; blockId: string; page: number; text: string }[] = [];
    let offset = 0;
    while (offset < block.text.length) {
      let end = Math.min(offset + 350, block.text.length);
      if (end < block.text.length) {
        const boundary = block.text.lastIndexOf('\n', end);
        if (boundary > offset + 100) end = boundary;
      }
      const text = block.text.slice(offset, end).trim();
      if (text.length >= 3) result.push({ id: `${block.id}:${offset}`, blockId: block.id, page: block.page, text });
      offset = end;
    }
    return result;
  });
}
export function anchoredGraphSchema(excerpts: ReturnType<typeof graphExcerpts>) {
  const ref = z.object({ excerptId: z.string() });
  const entity = graphExtractionSchema.shape.entities.element.omit({ mentions: true }).extend({
    mentions: z.array(ref.extend({ surface: z.string().min(1).max(500) })).min(1).max(1),
  });
  const relation = graphExtractionSchema.shape.relations.element.omit({ evidence: true }).extend({
    evidence: z.array(ref).min(1).max(2),
  });
  const resolve = (id: string) => {
    const excerpt = excerpts.find((e) => e.id === id);
    return { blockId: excerpt?.blockId ?? '', quote: excerpt?.text ?? '' };
  };
  return z.object({ entities: z.array(entity).max(12), relations: z.array(relation).max(16) }).transform((raw) => ({
    entities: raw.entities.map((e) => ({ ...e, mentions: e.mentions.map((m) => {
      let ref = resolve(m.excerptId);
      // A sentence can cross a snippet boundary. Only a uniquely matching
      // immediate neighbour on the same page may supply the entity mention.
      // Relation evidence never moves and is still checked independently.
      if (!exactQuote(ref.quote, m.surface)) {
        const at = excerpts.findIndex(e => e.id === m.excerptId);
        if (at >= 0) {
          const neighbours = [excerpts[at-1], excerpts[at+1]].filter(e => e && e.page === excerpts[at].page && exactQuote(e.text, m.surface));
          if (neighbours.length === 1) ref = resolve(neighbours[0].id);
        }
      }
      return { ...ref, surface: exactQuote(ref.quote, m.surface) ?? m.surface };
    }) })),
    relations: raw.relations.map((r) => ({ ...r, evidence: r.evidence.map((e) => resolve(e.excerptId)) })),
  }));
}
