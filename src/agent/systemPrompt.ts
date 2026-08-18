import os from "node:os";

export interface SystemPromptOptions {
  cwd: string;
  /** Skill catalog entries, injected so the model knows what it can invoke. */
  skills?: { name: string; description: string }[];
}

export function buildSystemPrompt(options: SystemPromptOptions): string {
  const sections: string[] = [
    "You are Stak, an agentic coding assistant running in the user's terminal.",
    "You help with software engineering tasks: reading and editing code, running commands, and answering questions about the codebase.",
    "Be concise. Prefer acting with the tools available to you over describing what could be done.",
    "",
    "# Environment",
    `Working directory: ${options.cwd}`,
    `Platform: ${process.platform}`,
    `OS: ${os.release()}`,
  ];

  if (options.skills && options.skills.length > 0) {
    sections.push(
      "",
      "# Available skills",
      "Invoke one with the Skill tool when the task matches its description.",
      ...options.skills.map((skill) => `- ${skill.name}: ${skill.description}`),
    );
  }

  return sections.join("\n");
}
