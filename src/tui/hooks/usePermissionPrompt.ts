import { useCallback, useEffect, useRef, useState } from "react";
import type { PermissionManager } from "../../permissions/manager.js";
import type {
  PermissionDecision,
  PermissionRequest,
} from "../../permissions/types.js";

/**
 * Bridges the manager's promise-based `check` to React state: the manager
 * awaits a promise this hook holds open, the prompt renders, and the user's
 * answer resolves it. The agent loop stays parked on that await throughout.
 */
export function usePermissionPrompt(permissions: PermissionManager) {
  const [request, setRequest] = useState<PermissionRequest | null>(null);
  const resolver = useRef<((decision: PermissionDecision) => void) | null>(null);

  useEffect(() => {
    permissions.setPrompter(
      (incoming) =>
        new Promise<PermissionDecision>((resolve) => {
          resolver.current = resolve;
          setRequest(incoming);
        }),
    );
  }, [permissions]);

  const decide = useCallback((decision: PermissionDecision) => {
    const resolve = resolver.current;
    resolver.current = null;
    setRequest(null);
    resolve?.(decision);
  }, []);

  return { request, decide };
}
