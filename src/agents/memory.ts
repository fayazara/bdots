/** Memory text helpers shared by the bot and the hub. Pure, so they test easily. */

/** Rough ceiling for one memory document, in characters (about 2k tokens). */
export const MAX_MEMORY_CHARS = 8_000

function normalize(line: string) {
  return line
    .replace(/^\s*[-*]\s*/, "")
    .replace(/\s+/g, " ")
    .replace(/[.!]+$/, "")
    .trim()
    .toLowerCase()
}

/**
 * Append one fact as a bullet, unless the document already says it.
 * Returns null when it is a duplicate, or an error when the document is full.
 */
export function appendFact(
  doc: string,
  fact: string
): { content: string } | { duplicate: true } | { error: string } {
  const clean = fact.replace(/\s+/g, " ").trim()
  if (!clean) return { error: "The fact is empty." }
  const wanted = normalize(clean)
  if (doc.split("\n").some((line) => normalize(line) === wanted)) {
    return { duplicate: true }
  }
  const content = `${doc.trimEnd()}${doc.trim() ? "\n" : ""}- ${clean}`
  if (content.length > MAX_MEMORY_CHARS) {
    return {
      error:
        "Memory is full. Rewrite it shorter first (merge related lines, drop what is no longer true), then save this fact.",
    }
  }
  return { content }
}
