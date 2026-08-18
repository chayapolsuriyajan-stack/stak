import fs from "node:fs/promises";
import path from "node:path";
import { globalSkillsDir, projectSkillsDir } from "../config/paths.js";
import { parseFrontmatter } from "../utils/frontmatter.js";
import type { Skill } from "./types.js";

interface SkillFrontmatter {
  name?: string;
  description?: string;
}

export interface LoadedSkills {
  skills: Skill[];
  /** Why a candidate was rejected, so a skill never fails to load in silence. */
  warnings: string[];
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
): Promise<LoadedSkills> {
  const byName = new Map<string, Skill>();
  const warnings: string[] = [];

  for (const dir of dirs) {
    const loaded = await loadFrom(dir.path, dir.source);
    warnings.push(...loaded.warnings);
    for (const skill of loaded.skills) {
      byName.set(skill.name, skill);
    }
  }

  return { skills: [...byName.values()], warnings };
}

async function loadFrom(dir: string, source: Skill["source"]): Promise<LoadedSkills> {
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return { skills: [], warnings: [] };
  }

  const skills: Skill[] = [];
  const warnings: string[] = [];

  for (const entry of entries) {
    const filePath = path.join(dir, entry, "SKILL.md");

    let raw: string;
    try {
      raw = await fs.readFile(filePath, "utf8");
    } catch {
      // Directories without a SKILL.md are simply not skills.
      continue;
    }

    const parsed = parseFrontmatter(raw);
    if (!parsed.ok) {
      warnings.push(`Skipped ${filePath}: ${parsed.reason}`);
      continue;
    }

    const frontmatter = parsed.value.data as SkillFrontmatter;
    const body = parsed.value.body;

    if (!frontmatter.description) {
      warnings.push(`Skipped ${filePath}: no description in frontmatter.`);
      continue;
    }

    if (body === "") {
      warnings.push(`Skipped ${filePath}: the body is empty.`);
      continue;
    }

    skills.push({
      name: frontmatter.name ?? entry,
      description: frontmatter.description,
      body,
      filePath,
      source,
    });
  }

  return { skills, warnings };
}
