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

/** Lets pending state updates and effects settle between keystrokes. */
function tick(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

/**
 * useInput's raw-mode listener attaches in a useEffect, which runs
 * asynchronously after Ink's initial render — a key written before it exists
 * is silently dropped. A single tick usually suffices locally but not on a
 * slow CI runner (this flaked on Windows + Node 20), so wait for the listener
 * Ink actually adds (`stdin.addListener("readable", ...)`) instead of
 * guessing a delay.
 */
async function inputReady(stdin: { listenerCount(event: string): number }): Promise<void> {
  for (let i = 0; i < 500 && stdin.listenerCount("readable") === 0; i++) {
    await tick();
  }
  if (stdin.listenerCount("readable") === 0) {
    throw new Error("Ink never attached its stdin listener");
  }
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
  await inputReady(stdin);
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
  await inputReady(stdin);
  stdin.write(KEY.down);
  await tick();
  stdin.write(KEY.enter);
  await tick();

  expect(onSelect).toHaveBeenCalledWith(sessions[1]);
});

// Regression: useInput re-subscribes its handler only after a re-render, and
// the Enter branch used to read `selected` from the handler's closure. Enter
// arriving before that re-subscribe (no pause after the arrow) saw the stale
// selection and resumed the wrong session.
test("down then enter with no pause still selects the moved-to session", async () => {
  const onSelect = vi.fn();
  const sessions = [session({ sessionId: "a" }), session({ sessionId: "b" })];

  const { stdin } = render(
    <SessionPicker sessions={sessions} onSelect={onSelect} onCancel={vi.fn()} />,
  );
  await inputReady(stdin);
  stdin.write(KEY.down);
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
  await inputReady(stdin);
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
  await inputReady(stdin);
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
  await inputReady(stdin);
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
  await inputReady(stdin);
  stdin.write(KEY.escape);
  await tick();

  expect(onCancel).toHaveBeenCalled();
  expect(onSelect).not.toHaveBeenCalled();
});
