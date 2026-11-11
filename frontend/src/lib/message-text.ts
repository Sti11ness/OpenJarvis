/** Text helpers shared between the message renderer and voice output. */

/** Remove <think> reasoning blocks so they are neither shown nor spoken. */
export function stripThinkTags(text: string): string {
  let cleaned = text.replace(/<think>[\s\S]*?<\/think>\s*/gi, '');
  cleaned = cleaned.replace(/^[\s\S]*?<\/think>\s*/i, '');
  cleaned = cleaned.replace(/<think>[\s\S]*$/i, '');
  return cleaned.trim();
}

const unspoken = /<think(?:>|(?![\s\S]))[\s\S]*?(?:<\/think>|(?![\s\S]))|```[\s\S]*?(?:```|(?![\s\S]))|~~~[\s\S]*?(?:~~~|(?![\s\S]))|`[^`]*(?:`|(?![\s\S]))|(?:^|(?<=\n))(?: {4}|\t)[^\r\n]*|https?:\/\/[^\s)\]]+/gi;

/** Keep offsets intact so streamed speech never splits inside code or a URL. */
export function maskUnspoken(text: string): string {
  return text.replace(unspoken, (part) => ' '.repeat(part.length));
}

/**
 * Turn a (usually markdown) answer into text that sounds right when read aloud: no emphasis
 * markers, heading hashes, list bullets, link syntax, bare URLs, code or emoji,
 * and a pause after lines that lack final punctuation.
 */
export function toSpeakableText(text: string): string {
  let t = stripThinkTags(text);
  t = t.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
  t = t.replace(unspoken, ' ');
  t = t.replace(/^\s{0,3}#{1,6}\s*/gm, '');
  t = t.replace(/^\s*(?:[-*•]|\d+[.)])\s+/gm, '');
  t = t.replace(/\*{1,3}|~~/g, '');
  t = t.replace(/(?<![\p{L}\p{N}])_+|_+(?![\p{L}\p{N}])/gu, '');
  t = t.replace(/[\p{Extended_Pictographic}️‍]/gu, '');
  const lines = t
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  // Only separate multiple lines; a single line is spoken as written.
  const sentences =
    lines.length > 1 ? lines.map((l) => (/[.!?:;]$/.test(l) ? l : `${l}.`)) : lines;
  return sentences.join(' ').replace(/\s{2,}/g, ' ').replace(/ +([.!?,;])/g, '$1').trim();
}
