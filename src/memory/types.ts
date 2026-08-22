export type MemorySource = "global" | "ancestor" | "project";

export interface MemoryFile {
  path: string;
  source: MemorySource;
  content: string;
  bytes: number;
  truncated: boolean;
}

export interface LoadedMemory {
  files: MemoryFile[];
  warnings: string[];
}
