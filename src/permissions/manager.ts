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

// Strictest first: plan can't even be asked into running something, build
// trusts edits but still asks for commands, auto trusts everything.
export const MODE_CYCLE: PermissionMode[] = ["plan", "build", "auto"];

export const MODE_LABELS: Record<PermissionMode, string> = {
  plan: "research freely — no edits or commands until you switch out",
  build: "edits run automatically, commands ask first",
  auto: "nothing asks",
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
    if (request.riskTier === "read-only") return "approved";

    // Plan mode never prompts for a risky call — there is nothing to ask,
    // since acting at all is what plan mode exists to defer.
    if (this.mode === "plan") return "denied";

    if (!this.requiresApproval(request.riskTier)) return "approved";
    if (!this.prompter) {
      // With no way to ask, denying is the safe default — the model gets told
      // and can suggest the command instead of running it.
      return "denied";
    }
    return this.prompter(request);
  }

  /** The message a denied tool call sees, tailored to why it was denied. */
  denialReason(toolName: string): string {
    if (this.mode === "plan") {
      return `${toolName} is disabled while in plan mode. Describe this step as part of your plan instead of running it — the user switches out of plan mode to approve the plan and let you execute it.`;
    }
    return `The user declined to run ${toolName}. Ask how they would like to proceed instead of retrying.`;
  }

  private requiresApproval(tier: RiskTier): boolean {
    if (tier === "read-only") return false;

    switch (this.mode) {
      case "auto":
        return false;
      case "build":
        // Commands stay gated even here: an edit leaves a diff you can read
        // and revert, an arbitrary shell command does not.
        return tier === "bash";
      case "plan":
        // check() short-circuits plan mode before this is ever reached.
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
