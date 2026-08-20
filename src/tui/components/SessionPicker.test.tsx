import { render } from "ink-testing-library";
import { expect, test, vi } from "vitest";
import type { SessionSummary } from "../../sessions/resume.js";
import { SessionPicker } from "./SessionPicker.js";

const KEY = {
  down: "[B",
  up: "[A",
  enter: "\r",
  escape: "",
};

/**
 * useInput's raw-mode listener attaches in a useEffect, which runs
 * asynchronously after Ink's initial render — writing to the mock stdin
 * synchronously right after render() fires before anything is listening.
 * A tick lets that effect (and each subsequent state update) settle first.
 */
function tick(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function session(overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    sessionId: "s1",
    filePath: "/tmp/s1.jsonl",
    messageCount: 4,
    preview: "explain closures",
    ...overrides,
  };
}

test("lists every session with its preview", () => {
  const sessions = [
    session({ sessionId: "a", preview: "explain closures" }),
    session({ sessionId: "b", preview: "fix the failing test" }),
  ];

  const { lastFrame } = render(
    <SessionPicker sessions={sessions} onSelect={vi.fn()} onCancel={vi.fn()} />,
  );

  expect(lastFrame()).toContain("explain closures");
  expect(lastFrame()).toContain("fix the failing test");
});

test("shows a plain message and nothing selectable when there are no sessions", () => {
  const { lastFrame } = render(
    <SessionPicker sessions={[]} onSelect={vi.fn()} onCancel={vi.fn()} />,
  );

  expect(lastFrame()).toContain("No previous sessions");
});

test("enter selects the first session by default", async () => {
  const onSelect = vi.fn();
  const sessions = [session({ sessionId: "a" }), session({ sessionId: "b" })];

  const { stdin } = render(
    <SessionPicker sessions={sessions} onSelect={onSelect} onCancel={vi.fn()} />,
  );
  await tick();
  stdin.write(KEY.enter);
  await tick();

  expect(onSelect).toHaveBeenCalledWith(sessions[0]);
});

test("down arrow moves the selection before enter confirms it", async () => {
  const onSelect = vi.fn();
  const sessions = [session({ sessionId: "a" }), session({ sessionId: "b" })];

  const { stdin } = render(
    <SessionPicker sessions={sessions} onSelect={onSelect} onCancel={vi.fn()} />,
  );
  await tick();
  stdin.write(KEY.down);
  await tick();
  stdin.write(KEY.enter);
  await tick();

  expect(onSelect).toHaveBeenCalledWith(sessions[1]);
});

test("selection cannot move past the last session", async () => {
  const onSelect = vi.fn();
  const sessions = [session({ sessionId: "a" }), session({ sessionId: "b" })];

  const { stdin } = render(
    <SessionPicker sessions={sessions} onSelect={onSelect} onCancel={vi.fn()} />,
  );
  await tick();
  for (let i = 0; i < 3; i++) {
    stdin.write(KEY.down);
    await tick();
  }
  stdin.write(KEY.enter);
  await tick();

  expect(onSelect).toHaveBeenCalledWith(sessions[1]);
});

test("a number key selects that session directly", async () => {
  const onSelect = vi.fn();
  const sessions = [
    session({ sessionId: "a" }),
    session({ sessionId: "b" }),
    session({ sessionId: "c" }),
  ];

  const { stdin } = render(
    <SessionPicker sessions={sessions} onSelect={onSelect} onCancel={vi.fn()} />,
  );
  await tick();
  stdin.write("2");
  await tick();

  expect(onSelect).toHaveBeenCalledWith(sessions[1]);
});

test("a number outside the range selects nothing", async () => {
  const onSelect = vi.fn();
  const sessions = [session({ sessionId: "a" })];

  const { stdin } = render(
    <SessionPicker sessions={sessions} onSelect={onSelect} onCancel={vi.fn()} />,
  );
  await tick();
  stdin.write("9");
  await tick();

  expect(onSelect).not.toHaveBeenCalled();
});

test("escape cancels instead of selecting", async () => {
  const onSelect = vi.fn();
  const onCancel = vi.fn();

  const { stdin } = render(
    <SessionPicker sessions={[session()]} onSelect={onSelect} onCancel={onCancel} />,
  );
  await tick();
  stdin.write(KEY.escape);
  await tick();

  expect(onCancel).toHaveBeenCalled();
  expect(onSelect).not.toHaveBeenCalled();
});
