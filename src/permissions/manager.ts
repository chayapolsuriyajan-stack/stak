import fs from "node:fs/promises";
import path from "node:path";
import { projectSettingsFile } from "../config/paths.js";
import type { ProjectSettings } from "../config/types.js";
import type { RiskTier } from "../tools/types.js";
import type {
  PermissionDecision,
  PermissionMode,
  PermissionPrompter,
  PermissionRequest,
} from "./types.js";

export const MODE_CYCLE: PermissionMode[] = ["ask", "accept-edits", "auto-bypass"];

export const MODE_LABELS: Record<PermissionMode, string> = {
  ask: "ask before edits and commands",
  "accept-edits": "auto-accept edits, ask for commands",
  "auto-bypass": "no prompts",
};

export class PermissionManager {
  private mode: PermissionMode;
  private prompter: PermissionPrompter | undefined;
  private readonly cwd: string;

  constructor(mode: PermissionMode, cwd: string = process.cwd()) {
    this.mode = mode;
    this.cwd = cwd;
  }

  /** The TUI registers itself here once it can render the approval prompt. */
  setPrompter(prompter: PermissionPrompter): void {
    this.prompter = prompter;
  }

  getMode(): PermissionMode {
    return this.mode;
  }

  async setMode(mode: PermissionMode): Promise<void> {
    this.mode = mode;
    await this.persist();
  }

  async cycleMode(): Promise<PermissionMode> {
    const next = MODE_CYCLE[(MODE_CYCLE.indexOf(this.mode) + 1) % MODE_CYCLE.length];
    await this.setMode(next ?? "ask");
    return this.mode;
  }

  async check(request: PermissionRequest): Promise<PermissionDecision> {
    if (!this.requiresApproval(request.riskTier)) return "approved";
    if (!this.prompter) {
      // With no way to ask, denying is the safe default — the model gets told
      // and can suggest the command instead of running it.
      return "denied";
    }
    return this.prompter(request);
  }

  private requiresApproval(tier: RiskTier): boolean {
    if (tier === "read-only") return false;

    switch (this.mode) {
      case "auto-bypass":
        return false;
      case "accept-edits":
        // Commands stay gated even here: an edit is reviewable after the fact,
        // an arbitrary shell command is not.
        return tier === "bash";
      case "ask":
        return true;
    }
  }

  /** Mode is project-scoped state, so it lives with the project, not the user. */
  private async persist(): Promise<void> {
    const file = projectSettingsFile(this.cwd);

    let settings: ProjectSettings = {};
    try {
      settings = JSON.parse(await fs.readFile(file, "utf8")) as ProjectSettings;
    } catch {
      // No settings file yet, or it is unreadable; write a fresh one.
    }

    settings.permissionMode = this.mode;

    try {
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
    } catch {
      // A read-only project directory should not take down the session.
    }
  }
}
