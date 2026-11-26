/**
 * The ready-made phrases beside Work needed on a repair item (Eddy,
 * 2026-11-26: "predetermined words like 'size ring up to #' on the left, the
 * actual work on the right"). The phrases themselves live in the dictionaries
 * (repair.new_.workPresets, by service); this adds one to the text. Pure.
 */

/** The spot in a phrase the clerk fills in. */
export const PRESET_BLANK = '#'

/**
 * The work-needed text with `phrase` added on its own line, and where the
 * phrase's "#" landed (to select it so the clerk types over it), or null when
 * the phrase has none.
 */
export function appendWorkPhrase(
  current: string,
  phrase: string,
): { text: string; blank: [number, number] | null } {
  const before = current.trimEnd()
  const text = before ? `${before}\n${phrase}` : phrase
  const at = phrase.indexOf(PRESET_BLANK)
  if (at < 0) return { text, blank: null }
  const start = text.length - phrase.length + at
  return { text, blank: [start, start + PRESET_BLANK.length] }
}
