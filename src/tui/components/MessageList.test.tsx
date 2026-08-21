import { render } from "ink-testing-library";
import { expect, test } from "vitest";
import type { TranscriptItem } from "../types.js";
import { MessageList } from "./MessageList.js";

const banner: TranscriptItem = {
  kind: "banner",
  version: "0.1.0",
  cwd: "/project",
  provider: "ollama",
  model: "qwen3.8-q3xl",
};

test("renders the banner and a message that follows it", () => {
  const items: TranscriptItem[] = [banner, { kind: "user", text: "hello" }];

  const { lastFrame } = render(<MessageList items={items} />);
  const frame = lastFrame() ?? "";

  expect(frame).toContain("█");
  expect(frame).toContain("hello");
});

test("keeps the banner as the leading item as more messages append", () => {
  // Ink's own <Static> (trusted upstream, not reimplemented here) owns the
  // print-once guarantee; ink-testing-library's stdout mock accumulates
  // every static write it has ever seen into one buffer by design
  // (`fullStaticOutput` in ink's core), so asserting an exact occurrence
  // count from `lastFrame()` after a rerender tests the harness's mock, not
  // this component. The real "prints exactly once in a real terminal" claim
  // is the manual scrollback check called out for this change.
  const { rerender, lastFrame } = render(
    <MessageList items={[banner, { kind: "user", text: "first" }]} />,
  );
  expect(lastFrame()).toContain("first");

  rerender(
    <MessageList
      items={[banner, { kind: "user", text: "first" }, { kind: "assistant", text: "second" }]}
    />,
  );
  expect(lastFrame()).toContain("second");
});

test("summarizes a tool call rather than dumping raw JSON", () => {
  const items: TranscriptItem[] = [
    banner,
    { kind: "tool", name: "read", input: { path: "src/cli.ts" } },
  ];

  const { lastFrame } = render(<MessageList items={items} />);
  const frame = lastFrame() ?? "";

  expect(frame).toContain("read(src/cli.ts)");
  expect(frame).not.toContain('{"path"');
});

test("collapses a finished thinking block to a breadcrumb by default", () => {
  const items: TranscriptItem[] = [
    banner,
    { kind: "thinking", text: "line one\nline two\nline three", streaming: false },
  ];

  const { lastFrame } = render(<MessageList items={items} />);
  const frame = lastFrame() ?? "";

  expect(frame).toContain("Thought for 3 lines");
  expect(frame).not.toContain("line one");
});

test("shows the full thinking text when showThinking is on", () => {
  const items: TranscriptItem[] = [
    banner,
    { kind: "thinking", text: "the actual reasoning", streaming: false },
  ];

  const { lastFrame } = render(<MessageList items={items} showThinking />);
  const frame = lastFrame() ?? "";

  expect(frame).toContain("the actual reasoning");
  expect(frame).not.toContain("Thought for");
});

test("a still-streaming thinking block shows an in-progress breadcrumb", () => {
  const items: TranscriptItem[] = [
    banner,
    { kind: "thinking", text: "still going", streaming: true },
  ];

  const { lastFrame } = render(<MessageList items={items} />);

  expect(lastFrame() ?? "").toContain("Thinking…");
});
