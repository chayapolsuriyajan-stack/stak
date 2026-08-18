import os from "node:os";
import path from "node:path";

/** Global config lives with the user; secrets are only ever stored here. */
export function globalDir(): string {
  return path.join(os.homedir(), ".stak");
}

export function globalConfigFile(): string {
  return path.join(globalDir(), "config.json");
}

/** Project config is per working directory and must never hold secrets. */
export function projectDir(cwd: string = process.cwd()): string {
  return path.join(cwd, ".stak");
}

export function projectSettingsFile(cwd: string = process.cwd()): string {
  return path.join(projectDir(cwd), "settings.json");
}

export function sessionsDir(cwd: string = process.cwd()): string {
  return path.join(projectDir(cwd), "sessions");
}

export function globalSkillsDir(): string {
  return path.join(globalDir(), "skills");
}

export function projectSkillsDir(cwd: string = process.cwd()): string {
  return path.join(projectDir(cwd), "skills");
}

export function globalCommandsDir(): string {
  return path.join(globalDir(), "commands");
}

export function projectCommandsDir(cwd: string = process.cwd()): string {
  return path.join(projectDir(cwd), "commands");
}
