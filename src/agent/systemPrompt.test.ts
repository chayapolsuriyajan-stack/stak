import { describe, expect, test } from "vitest";
import { buildSystemPrompt } from "./systemPrompt.js";

describe("buildSystemPrompt", () => {
  test("includes the working directory", () => {
    expect(buildSystemPrompt({ cwd: "/some/project" })).toContain("/some/project");
  });

  test("omits the skills section when there are none", () => {
    expect(buildSystemPrompt({ cwd: "/p" })).not.toContain("Available skills");
  });

  test("lists skills when present", () => {
    const prompt = buildSystemPrompt({
      cwd: "/p",
      skills: [{ name: "reviewer", description: "review code for bugs" }],
    });

    expect(prompt).toContain("reviewer");
    expect(prompt).toContain("review code for bugs");
  });

  test("omits the plan-mode section by default", () => {
    expect(buildSystemPrompt({ cwd: "/p" })).not.toContain("Plan mode");
    expect(buildSystemPrompt({ cwd: "/p", planMode: false })).not.toContain("Plan mode");
  });

  test("adds explicit plan-mode instructions when active", () => {
    const prompt = buildSystemPrompt({ cwd: "/p", planMode: true });

    expect(prompt).toContain("Plan mode is active");
    // The model should be told which tools are gone, not left to discover it
    // via failed calls.
    expect(prompt).toContain("write");
    expect(prompt).toContain("bash");
  });

  test("tells the model not to nag the user to switch modes itself", () => {
    const prompt = buildSystemPrompt({ cwd: "/p", planMode: true });

    expect(prompt.toLowerCase()).toContain("do not");
  });

  test("omits the memory section when memory is not provided", () => {
    const withoutMemory = buildSystemPrompt({ cwd: "/p" });

    expect(withoutMemory).not.toContain("# Memory");
    expect(withoutMemory).toBe(buildSystemPrompt({ cwd: "/p" }));
  });

  test("omits the memory section when memory is empty or whitespace-only", () => {
    const baseline = buildSystemPrompt({ cwd: "/p" });

    expect(buildSystemPrompt({ cwd: "/p", memory: "" })).toBe(baseline);
    expect(buildSystemPrompt({ cwd: "/p", memory: "   " })).toBe(baseline);
  });

  test("includes memory content after the skills section and before plan mode", () => {
    const prompt = buildSystemPrompt({
      cwd: "/p",
      skills: [{ name: "reviewer", description: "review code for bugs" }],
      planMode: true,
      memory: "The user prefers tabs over spaces.",
    });

    expect(prompt).toContain("# Memory");
    expect(prompt).toContain("The user prefers tabs over spaces.");

    const skillsIndex = prompt.indexOf("Available skills");
    const memoryIndex = prompt.indexOf("# Memory");
    const planModeIndex = prompt.indexOf("Plan mode is active");

    expect(skillsIndex).toBeGreaterThan(-1);
    expect(memoryIndex).toBeGreaterThan(skillsIndex);
    expect(planModeIndex).toBeGreaterThan(memoryIndex);
  });

  test("trims memory content before inserting it", () => {
    const prompt = buildSystemPrompt({ cwd: "/p", memory: "  trimmed memory  " });

    expect(prompt).toContain("# Memory\ntrimmed memory");
  });
});
