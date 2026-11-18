import type { ToolRiskLevel } from "./types.js";

export type PolicyDecision =
  | { action: "allow" }
  | { action: "require_approval"; reason: string; riskLevel: ToolRiskLevel }
  | { action: "deny"; reason: string };

const DANGEROUS_COMMAND_PATTERNS: readonly RegExp[] = [
  /\brm\s+-rf\s+\/(?:\s|$)/i,
  /\brm\s+-rf\s+[A-Za-z]:\\/i,
  /\bmkfs\b/i,
  /\bformat\s+[A-Za-z]:/i,
  /\bshutdown\b/i,
  /\breboot\b/i,
  /\breg\s+delete\b/i,
  /\bcurl\b.*\|\s*(?:sh|bash)\b/i,
  /\bwget\b.*\|\s*(?:sh|bash)\b/i,
  /\bpowershell\b.*-enc(?:odedcommand)?\b/i,
  /\b(?:sudo|su|runas)\b/i,
  /\bnpm\s+install\s+-g\b/i,
  /\bpnpm\s+add\s+-g\b/i,
];

const SENSITIVE_FILE_PATTERNS: readonly RegExp[] = [
  /^\.git(?:\/|$)/i,
  /(?:^|\/)\.env(?:\.|$)/i,
  /(?:^|\/)id_rsa/i,
  /(?:^|\/)\.ssh(?:\/|$)/i,
];

export interface ExecutionPolicyOptions {
  /** If true, even normal workspace file writes require explicit user approval. Default: true for high-safety Desktop mode. */
  requireApprovalForWrites?: boolean;
}

/**
 * Evaluates tool calls against security & safety policy before execution.
 * - Read tools inside workspace: allowed
 * - Dangerous/system-wide commands: hard denied
 * - Protected file writes, deletes, shell execution, git writes, external ops: approval required
 */
export class ExecutionPolicy {
  private readonly requireApprovalForWrites: boolean;

  constructor(options: ExecutionPolicyOptions = {}) {
    this.requireApprovalForWrites = options.requireApprovalForWrites ?? false;
  }

  evaluate(toolName: string, args: Record<string, unknown>): PolicyDecision {
    switch (toolName) {
      case "list_files":
      case "read_file":
      case "grep_files":
      case "git_status":
      case "git_diff":
        return { action: "allow" };

      case "write_file": {
        const targetPath = String(args.path ?? "");
        if (SENSITIVE_FILE_PATTERNS.some((re) => re.test(targetPath))) {
          return {
            action: "require_approval",
            riskLevel: "write",
            reason: `Writing sensitive path "${targetPath}" requires approval`,
          };
        }
        if (this.requireApprovalForWrites) {
          return {
            action: "require_approval",
            riskLevel: "write",
            reason: `Write to "${targetPath}" requires approval`,
          };
        }
        return { action: "allow" };
      }

      case "delete_file": {
        const targetPath = String(args.path ?? "");
        if (SENSITIVE_FILE_PATTERNS.some((re) => re.test(targetPath))) {
          return {
            action: "deny",
            reason: `Deleting protected path "${targetPath}" is blocked by policy`,
          };
        }
        return {
          action: "require_approval",
          riskLevel: "write",
          reason: `Deleting "${targetPath}" requires explicit approval`,
        };
      }

      case "git_commit":
        return {
          action: "require_approval",
          riskLevel: "git_write",
          reason: "Creating a Git commit modifies repository history and requires approval",
        };

      case "run_command": {
        const command = String(args.command ?? "").trim();
        if (!command) {
          return { action: "deny", reason: "Empty command is not allowed" };
        }
        for (const pattern of DANGEROUS_COMMAND_PATTERNS) {
          if (pattern.test(command)) {
            return {
              action: "deny",
              reason: `Command matches blocked dangerous/system-wide pattern: ${command}`,
            };
          }
        }
        return {
          action: "require_approval",
          riskLevel: "exec",
          reason: `Executing shell command requires approval: ${command}`,
        };
      }

      default:
        return {
          action: "require_approval",
          riskLevel: "external",
          reason: `Tool "${toolName}" requires approval`,
        };
    }
  }
}
