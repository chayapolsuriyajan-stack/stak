import { describe, expect, test } from "vitest";
import { createThinkTagSplitter } from "./thinkTags.js";

describe("createThinkTagSplitter", () => {
  test("passes ordinary text through untouched when there are no tags", () => {
    const splitter = createThinkTagSplitter();

    expect(splitter.push("hello world")).toEqual({ thinking: "", text: "hello world" });
    expect(splitter.end()).toEqual({ thinking: "", text: "" });
  });

  test("routes content inside a single-push think block to thinking", () => {
    const splitter = createThinkTagSplitter();

    expect(splitter.push("<think>reasoning here</think>the answer")).toEqual({
      thinking: "reasoning here",
      text: "the answer",
    });
  });

  test("splits a tag across chunk boundaries", () => {
    const splitter = createThinkTagSplitter();

    expect(splitter.push("<thi")).toEqual({ thinking: "", text: "" });
    expect(splitter.push("nk>hello")).toEqual({ thinking: "hello", text: "" });
  });

  test("splits the closing tag across chunk boundaries too", () => {
    const splitter = createThinkTagSplitter();

    // Thinking content streams out immediately, not held until the closing
    // tag resolves — only the ambiguous "</thi" suffix itself is held back.
    expect(splitter.push("<think>reasoning</thi")).toEqual({
      thinking: "reasoning",
      text: "",
    });
    expect(splitter.push("nk>answer")).toEqual({ thinking: "", text: "answer" });
  });

  test("splits one character at a time and still reconstructs correctly", () => {
    const splitter = createThinkTagSplitter();
    const input = "<think>abc</think>def";
    let thinking = "";
    let text = "";

    for (const char of input) {
      const chunk = splitter.push(char);
      thinking += chunk.thinking;
      text += chunk.text;
    }
    const final = splitter.end();

    expect(thinking + final.thinking).toBe("abc");
    expect(text + final.text).toBe("def");
  });

  test("an unclosed think block streams as thinking without waiting for end()", () => {
    const splitter = createThinkTagSplitter();

    // No ambiguous partial-tag suffix here, so it's emitted immediately —
    // end() only needs to flush genuinely held-back characters, and there
    // are none left once push() has already released everything safe.
    expect(splitter.push("<think>the model got cut off mid-thought")).toEqual({
      thinking: "the model got cut off mid-thought",
      text: "",
    });
    expect(splitter.end()).toEqual({ thinking: "", text: "" });
  });

  test("end() flushes a genuinely ambiguous suffix left over when the stream stops", () => {
    const splitter = createThinkTagSplitter();

    // "</thi" is held back mid-stream since it could still become "</think>".
    expect(splitter.push("<think>reasoning</thi")).toEqual({
      thinking: "reasoning",
      text: "",
    });
    // The stream ends here without ever resolving it — end() must not lose
    // those held-back characters.
    expect(splitter.end()).toEqual({ thinking: "</thi", text: "" });
  });

  test("flushes trailing ordinary text on end()", () => {
    const splitter = createThinkTagSplitter();

    splitter.push("hello");
    expect(splitter.end()).toEqual({ thinking: "", text: "" });
  });

  test("a literal < that never becomes a tag is eventually released as text", () => {
    const splitter = createThinkTagSplitter();

    const first = splitter.push("a < b");
    const final = splitter.end();

    expect(first.text + final.text).toBe("a < b");
    expect(first.thinking + final.thinking).toBe("");
  });

  test("does not confuse a bare < followed by unrelated text with a tag", () => {
    const splitter = createThinkTagSplitter();

    // "<th" is a valid partial prefix of "<think>" and gets held back, but
    // "<thx" is not a prefix of anything and must release immediately.
    const a = splitter.push("<th");
    const b = splitter.push("x hello");

    expect(a.text).toBe("");
    expect(b.text).toBe("<thx hello");
  });

  test("handles multiple think blocks in one turn", () => {
    const splitter = createThinkTagSplitter();

    const result = splitter.push(
      "<think>first</think>partial answer<think>second</think>rest",
    );

    expect(result).toEqual({
      thinking: "firstsecond",
      text: "partial answerrest",
    });
  });

  test("an empty push is a no-op", () => {
    const splitter = createThinkTagSplitter();

    expect(splitter.push("")).toEqual({ thinking: "", text: "" });
  });

  test("text immediately after </think> with no gap is not swallowed", () => {
    const splitter = createThinkTagSplitter();

    expect(splitter.push("<think>x</think>y")).toMatchObject({ text: "y" });
  });
});
