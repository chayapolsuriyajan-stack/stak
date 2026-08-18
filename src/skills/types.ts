export interface Skill {
  name: string;
  description: string;
  /** Markdown body injected into the conversation when the skill is invoked. */
  body: string;
  filePath: string;
  source: "global" | "project";
}
