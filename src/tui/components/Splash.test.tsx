import { render } from "ink-testing-library";
import { expect, test } from "vitest";
import { Splash } from "./Splash.js";

test("renders the wordmark, version, provider/model, and cwd", () => {
  const { lastFrame } = render(
    <Splash version="0.1.0" cwd="/some/project" provider="ollama" model="qwen3.8-q3xl" />,
  );
  const frame = lastFrame() ?? "";

  expect(frame).toContain("█");
  expect(frame).toContain("v0.1.0");
  expect(frame).toContain("ollama");
  expect(frame).toContain("qwen3.8-q3xl");
  expect(frame).toContain("/some/project");
  expect(frame).toContain("/help");
});
