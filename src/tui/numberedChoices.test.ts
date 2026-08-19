import { describe, expect, test } from "vitest";
import { extractNumberedChoices, resolveNumberedReply } from "./numberedChoices.js";

describe("extractNumberedChoices", () => {
  test("reads a simple numbered list", () => {
    const text = "Pick one:\n1. Apples\n2. Bananas\n3. Cherries";

    expect(extractNumberedChoices(text)).toEqual(["Apples", "Bananas", "Cherries"]);
  });

  test("accepts ) and : as the number's delimiter", () => {
    expect(extractNumberedChoices("1) Apples\n2) Bananas")).toEqual([
      "Apples",
      "Bananas",
    ]);
    expect(extractNumberedChoices("1: Apples\n2: Bananas")).toEqual([
      "Apples",
      "Bananas",
    ]);
  });

  test("returns undefined for a single numbered line", () => {
    // One line is far more likely to be an incidental "1." in prose than a menu.
    expect(extractNumberedChoices("Step 1. Open the file")).toBeUndefined();
  });

  test("returns undefined when there is no numbered list at all", () => {
    expect(extractNumberedChoices("Just a normal reply.")).toBeUndefined();
  });

  test("stops counting a list that skips a number", () => {
    // 1, 2, 4 — item 4 does not continue the sequence, so only 1 and 2 count.
    const text = "1. Apples\n2. Bananas\n4. Dates";

    expect(extractNumberedChoices(text)).toEqual(["Apples", "Bananas"]);
  });

  test("ignores a list that starts above 1", () => {
    expect(extractNumberedChoices("2. Bananas\n3. Cherries")).toBeUndefined();
  });

  test("only counts lines up to where the sequence breaks, even if it resumes", () => {
    // A restarted "1." later in the text (e.g. a second, unrelated list) should
    // not retroactively join the first list.
    const text = "1. Apples\n2. Bananas\nSome prose.\n1. Unrelated\n2. Also unrelated";

    expect(extractNumberedChoices(text)).toEqual(["Apples", "Bananas"]);
  });
});

describe("resolveNumberedReply", () => {
  const choices = ["Apples", "Bananas", "Cherries"];

  test("maps a bare number to the matching option", () => {
    expect(resolveNumberedReply("2", choices)).toBe("Bananas");
  });

  test("tolerates surrounding whitespace", () => {
    expect(resolveNumberedReply("  1  ", choices)).toBe("Apples");
  });

  test("returns undefined when there are no choices on offer", () => {
    expect(resolveNumberedReply("1", undefined)).toBeUndefined();
  });

  test("returns undefined for a number outside the range", () => {
    expect(resolveNumberedReply("0", choices)).toBeUndefined();
    expect(resolveNumberedReply("4", choices)).toBeUndefined();
  });

  test("returns undefined for anything that is not a bare integer", () => {
    expect(resolveNumberedReply("2 bananas please", choices)).toBeUndefined();
    expect(resolveNumberedReply("two", choices)).toBeUndefined();
    expect(resolveNumberedReply("2.5", choices)).toBeUndefined();
  });
});
