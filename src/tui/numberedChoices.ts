/**
 * When the model's last reply ends with a numbered list, a bare digit typed
 * next answers that list directly rather than requiring the option's full
 * text to be retyped. Detection is deliberately conservative — numbering must
 * start at 1 and run without gaps — so an incidental "2." in prose is not
 * mistaken for a menu.
 */
const LIST_ITEM = /^\s*(\d+)[.):]\s+(.+)$/;

export function extractNumberedChoices(text: string): string[] | undefined {
  const items: string[] = [];

  for (const rawLine of text.split("\n")) {
    const match = LIST_ITEM.exec(rawLine);
    if (!match) continue;

    const [, numberStr, rest] = match;
    const number = Number(numberStr);
    if (number !== items.length + 1) continue; // gap or out of order: not a menu

    items.push((rest ?? "").trim());
  }

  return items.length >= 2 ? items : undefined;
}

/**
 * Resolves a bare-number reply against the choices on offer. Returns the
 * option's text so the model receives a normal message, or undefined when the
 * input is not a bare in-range number.
 */
export function resolveNumberedReply(
  input: string,
  choices: string[] | undefined,
): string | undefined {
  if (!choices || !/^\d+$/.test(input.trim())) return undefined;

  const index = Number(input.trim()) - 1;
  return index >= 0 && index < choices.length ? choices[index] : undefined;
}
