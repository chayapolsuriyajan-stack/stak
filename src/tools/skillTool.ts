import { z } from "zod";
import type { Skill } from "../skills/types.js";
import type { Tool } from "./types.js";

const schema = z.object({
  name: z.string().describe("Name of the skill to load"),
});

/**
 * Loading a skill is just a tool call whose result is the skill's instructions,
 * so the model receives them the same way it receives any other tool output.
 * That keeps skills working on any provider with native tool-calling, with no
 * special protocol support.
 */
export function createSkillTool(skills: Skill[]): Tool<z.infer<typeof schema>> {
  const byName = new Map(skills.map((skill) => [skill.name, skill]));

  return {
    name: "Skill",
    description:
      skills.length === 0
        ? "Load a skill's instructions. No skills are currently available."
        : `Load a skill's instructions when the task matches its description. Available: ${skills
            .map((skill) => skill.name)
            .join(", ")}.`,
    schema,
    riskTier: "read-only",

    async execute(args) {
      const skill = byName.get(args.name);

      if (!skill) {
        const available = [...byName.keys()];
        return {
          output:
            available.length === 0
              ? "No skills are available."
              : `No skill named "${args.name}". Available: ${available.join(", ")}.`,
          isError: true,
        };
      }

      return {
        output: `Instructions for the "${skill.name}" skill. Follow them for the rest of this task.\n\n${skill.body}`,
      };
    },
  };
}
