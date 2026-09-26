// Locate a quotation while tolerating PDF whitespace only. Return the original
// substring, never the model's reconstructed typography. Punctuation is retained.
export function exactQuote(text: string, quote: string): string | null {
  const needle = quote.normalize('NFKC').replace(/\s/gu, '').toLowerCase();
  if (needle.length < 3) return null;
  if (text.includes(quote)) return quote;
  let flat = '';
  const starts: number[] = [], ends: number[] = [];
  let offset = 0;
  for (const character of text) {
    const normalized = character.normalize('NFKC').replace(/\s/gu, '').toLowerCase();
    for (let i = 0; i < normalized.length; i++) {
      starts.push(offset); ends.push(offset + character.length);
    }
    flat += normalized;
    offset += character.length;
  }
  const at = flat.indexOf(needle);
  if (at < 0) return null;
  // Ambiguous normalized matches cannot select a unique original passage.
  if (flat.indexOf(needle, at + 1) >= 0) return null;
  return text.slice(starts[at], ends[at + needle.length - 1]);
}
