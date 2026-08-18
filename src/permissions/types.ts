import type { PermissionMode } from "../config/types.js";
import type { RiskTier } from "../tools/types.js";

export type { PermissionMode };

export interface PermissionRequest {
  toolName: string;
  riskTier: RiskTier;
  args: unknown;
}

export type PermissionDecision = "approved" | "denied";

/** Invoked when a decision needs the user. Resolving the promise unblocks the
 * agent loop, which is parked on it. */
export type PermissionPrompter = (
  request: PermissionRequest,
) => Promise<PermissionDecision>;
