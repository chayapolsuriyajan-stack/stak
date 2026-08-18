import { render } from "ink-testing-library";
import { expect, test } from "vitest";
import { Splash } from "./Splash.js";

test("renders the wordmark, version, and command list", () => {
  const { lastFrame } = render(<Splash version="0.1.0" />);
  const frame = lastFrame() ?? "";

  expect(frame).toContain("█");
  expect(frame).toContain("v0.1.0");
  expect(frame).toContain("/help");
  expect(frame).toContain("/model");
  expect(frame).toContain("/exit");
});
