import os from "node:os";
import type { PermissionMode } from "../config/types.js";

export interface SystemPromptOptions {
  cwd: string;
  /** Skill catalog entries, injected so the model knows what it can invoke. */
  skills?: { name: string; description: string }[];
  /** Current permission mode — plan steers research behavior; build/auto get
   * one honest line about their gating so the model predicts prompts. */
  permissionMode?: PermissionMode;
  /** Freeform memory content, injected as its own section when non-blank. */
  memory?: string;
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

  if (options.memory && options.memory.trim() !== "") {
    sections.push("", "# Memory", options.memory.trim());
  }

  if (options.permissionMode === "plan") {
    sections.push(
      "",
      "# Plan mode is active",
      "The write, edit, and bash tools are disabled — calling them will fail. Use read, grep, glob, and Skill freely to research the task.",
      "Once you understand what's needed, present a clear, concrete plan for what you would do and stop. Do not attempt the change yet.",
      "The user reviews the plan and switches out of plan mode themselves when they want you to proceed — do not tell them to do this, and do not retry blocked tools waiting for that to happen.",
    );
  } else if (options.permissionMode === "build") {
    sections.push(
      "",
      "# Permissions",
      "File edits run automatically without approval. Shell commands require the user's approval, so batch meaningful work between them instead of asking for each trivial step.",
    );
  } else if (options.permissionMode === "auto") {
    sections.push(
      "",
      "# Permissions",
      "All tools run without approval prompts.",
    );
  }

  return sections.join("\n");
}
