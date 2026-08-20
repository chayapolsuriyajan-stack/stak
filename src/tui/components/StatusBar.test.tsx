import { render } from "ink-testing-library";
import { expect, test } from "vitest";
import { StatusBar } from "./StatusBar.js";

test("idle: shows the hint and provider/model", () => {
  const { lastFrame } = render(
    <StatusBar
      provider="ollama"
      model="qwen3.8-q3xl"
      busy={false}
      hint="enter send · shift+tab ask"
    />,
  );
  const frame = lastFrame() ?? "";

  expect(frame).toContain("enter send");
  expect(frame).toContain("ollama");
  expect(frame).toContain("qwen3.8-q3xl");
});

test("busy with a phase: shows the phase and round instead of the generic hint", () => {
  const { lastFrame } = render(
    <StatusBar
      provider="ollama"
      model="qwen3.8-q3xl"
      busy
      phase={{ tool: "bash" }}
      round={2}
    />,
  );
  const frame = lastFrame() ?? "";

  expect(frame).toContain("bash");
  expect(frame).toContain("round 2");
  expect(frame).toContain("esc to interrupt");
});

test("busy with no phase yet: falls back to the generic working hint", () => {
  const { lastFrame } = render(
    <StatusBar provider="ollama" model="qwen3.8-q3xl" busy />,
  );

  expect(lastFrame() ?? "").toContain("working");
});

test("shows stats when present, including an unknown context limit gracefully", () => {
  const { lastFrame } = render(
    <StatusBar
      provider="ollama"
      model="qwen3.8-q3xl"
      busy={false}
      stats={{ outputTokens: 42, approx: false, latestInputTokens: 100, generatingMs: 1000 }}
    />,
  );
  const frame = lastFrame() ?? "";

  expect(frame).toContain("42 out");
  // No contextLength was passed, so no "ctx" segment should appear.
  expect(frame).not.toContain("ctx");
});

test("shows the context segment once a limit is known", () => {
  const { lastFrame } = render(
    <StatusBar
      provider="ollama"
      model="qwen3.8-q3xl"
      busy={false}
      stats={{ outputTokens: 42, approx: false, latestInputTokens: 8000, generatingMs: 1000 }}
      contextLength={16_384}
    />,
  );

  expect(lastFrame() ?? "").toContain("ctx");
});

test("renders nothing extra when there are no stats yet", () => {
  const { lastFrame } = render(
    <StatusBar provider="ollama" model="qwen3.8-q3xl" busy={false} />,
  );
  const frame = lastFrame() ?? "";

  expect(frame).toContain("ollama");
  expect(frame).not.toContain("out");
});
