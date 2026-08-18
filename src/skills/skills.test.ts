import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { buildSystemPrompt } from "../agent/systemPrompt.js";
import { createSkillTool } from "../tools/skillTool.js";
import { loadSkills } from "./loader.js";
import type { Skill } from "./types.js";

let cwd: string;

beforeEach(async () => {
  cwd = await fs.mkdtemp(path.join(os.tmpdir(), "stak-skill-"));
});

afterEach(async () => {
  await fs.rm(cwd, { recursive: true, force: true });
});

async function writeSkill(dir: string, name: string, contents: string) {
  await fs.mkdir(path.join(dir, name), { recursive: true });
  await fs.writeFile(path.join(dir, name, "SKILL.md"), contents);
}

function dirs(cwd: string) {
  return [
    { path: path.join(cwd, "global-skills"), source: "global" as const },
    { path: path.join(cwd, ".stak", "skills"), source: "project" as const },
  ];
}

describe("loading", () => {
  test("reads name, description, and body", async () => {
    await writeSkill(
      path.join(cwd, ".stak", "skills"),
      "pirate",
      "---\nname: pirate\ndescription: speak like a pirate\n---\nAlways say arrr.",
    );

    const skills = await loadSkills(cwd, dirs(cwd));

    expect(skills).toHaveLength(1);
    expect(skills[0]?.name).toBe("pirate");
    expect(skills[0]?.description).toBe("speak like a pirate");
    expect(skills[0]?.body).toBe("Always say arrr.");
    expect(skills[0]?.source).toBe("project");
  });

  test("falls back to the directory name when frontmatter omits it", async () => {
    await writeSkill(
      path.join(cwd, ".stak", "skills"),
      "reviewer",
      "---\ndescription: review code\n---\nReview carefully.",
    );

    const skills = await loadSkills(cwd, dirs(cwd));

    expect(skills[0]?.name).toBe("reviewer");
  });

  test("a project skill replaces a global one of the same name", async () => {
    await writeSkill(
      path.join(cwd, "global-skills"),
      "shared",
      "---\ndescription: global version\n---\nGlobal body.",
    );
    await writeSkill(
      path.join(cwd, ".stak", "skills"),
      "shared",
      "---\ndescription: project version\n---\nProject body.",
    );

    const skills = await loadSkills(cwd, dirs(cwd));

    expect(skills).toHaveLength(1);
    expect(skills[0]?.description).toBe("project version");
    expect(skills[0]?.source).toBe("project");
  });

  test("skips a skill with no description", async () => {
    await writeSkill(path.join(cwd, ".stak", "skills"), "broken", "---\n---\nBody only.");

    expect(await loadSkills(cwd, dirs(cwd))).toEqual([]);
  });

  test("skips a skill with an empty body", async () => {
    await writeSkill(
      path.join(cwd, ".stak", "skills"),
      "empty",
      "---\ndescription: does nothing\n---\n",
    );

    expect(await loadSkills(cwd, dirs(cwd))).toEqual([]);
  });

  test("ignores a directory with no SKILL.md", async () => {
    await fs.mkdir(path.join(cwd, ".stak", "skills", "notaskill"), { recursive: true });

    expect(await loadSkills(cwd, dirs(cwd))).toEqual([]);
  });

  test("a missing skills directory is not an error", async () => {
    expect(await loadSkills(cwd, dirs(cwd))).toEqual([]);
  });
});

describe("Skill tool", () => {
  const skills: Skill[] = [
    {
      name: "pirate",
      description: "speak like a pirate",
      body: "Always say arrr.",
      filePath: "/tmp/pirate/SKILL.md",
      source: "project",
    },
  ];

  test("returns the body as the tool result", async () => {
    const tool = createSkillTool(skills);

    const result = await tool.execute({ name: "pirate" }, { cwd: "/tmp" });

    expect(result.isError).toBeUndefined();
    expect(result.output).toContain("Always say arrr.");
    expect(result.output).toContain("pirate");
  });

  test("reports an unknown skill and lists what exists", async () => {
    const tool = createSkillTool(skills);

    const result = await tool.execute({ name: "ninja" }, { cwd: "/tmp" });

    expect(result.isError).toBe(true);
    expect(result.output).toContain("pirate");
  });

  test("never needs permission, being read-only", () => {
    expect(createSkillTool(skills).riskTier).toBe("read-only");
  });

  test("names the available skills in its description", () => {
    expect(createSkillTool(skills).description).toContain("pirate");
    expect(createSkillTool([]).description).toContain("No skills");
  });
});

describe("system prompt", () => {
  test("lists skills so the model knows they exist", () => {
    const prompt = buildSystemPrompt({
      cwd: "/tmp",
      skills: [{ name: "pirate", description: "speak like a pirate" }],
    });

    expect(prompt).toContain("pirate");
    expect(prompt).toContain("speak like a pirate");
  });

  test("omits the section entirely when there are no skills", () => {
    expect(buildSystemPrompt({ cwd: "/tmp", skills: [] })).not.toContain(
      "Available skills",
    );
  });
});
