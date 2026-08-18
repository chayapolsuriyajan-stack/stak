import fs from "node:fs/promises";
import path from "node:path";
import matter from "gray-matter";
import { globalSkillsDir, projectSkillsDir } from "../config/paths.js";
import type { Skill } from "./types.js";

interface SkillFrontmatter {
  name?: string;
  description?: string;
}

/**
 * Discovers skills as `<dir>/<skill-name>/SKILL.md`. Global skills load first
 * so a project skill of the same name replaces the user's version.
 *
 * `dirs` is injectable so tests need not touch the real home directory.
 */
export async function loadSkills(
  cwd: string = process.cwd(),
  dirs: { path: string; source: Skill["source"] }[] = [
    { path: globalSkillsDir(), source: "global" },
    { path: projectSkillsDir(cwd), source: "project" },
  ],
): Promise<Skill[]> {
  const byName = new Map<string, Skill>();

  for (const dir of dirs) {
    for (const skill of await loadFrom(dir.path, dir.source)) {
      byName.set(skill.name, skill);
    }
  }

  return [...byName.values()];
}

async function loadFrom(dir: string, source: Skill["source"]): Promise<Skill[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return [];
  }

  const skills: Skill[] = [];

  for (const entry of entries) {
    const filePath = path.join(dir, entry, "SKILL.md");

    let raw: string;
    try {
      raw = await fs.readFile(filePath, "utf8");
    } catch {
      // Directories without a SKILL.md are simply not skills.
      continue;
    }

    const parsed = matter(raw);
    const frontmatter = parsed.data as SkillFrontmatter;
    const body = parsed.content.trim();

    // A skill with no description cannot be chosen sensibly by the model, and
    // an empty body would inject nothing, so both are required.
    if (!frontmatter.description || body === "") continue;

    skills.push({
      name: frontmatter.name ?? entry,
      description: frontmatter.description,
      body,
      filePath,
      source,
    });
  }

  return skills;
}
