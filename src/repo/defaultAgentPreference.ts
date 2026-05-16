export type DefaultAgentCliId =
  | "none"
  | "cursor-agent-cli"
  | "claude-code";

export const DEFAULT_AGENT_CLI_STORAGE_KEY =
  "compound:default-agent-cli-preference";

export type DefaultAgentCliOption = {
  id: DefaultAgentCliId;
  /** Menu label shown in Preferences. */
  label: string;
  /** Hint under the picker. */
  description: string;
  /** Executable line sent to the shell after startup, or none for today's behavior. */
  commandLine: string | null;
};

export const DEFAULT_AGENT_CLI_OPTIONS: readonly DefaultAgentCliOption[] = [
  {
    id: "none",
    label: "None (plain shell)",
    description:
      "Open the Agent tab terminal with your default login shell only, as today.",
    commandLine: null,
  },
  {
    id: "cursor-agent-cli",
    label: "Cursor Agent CLI",
    description:
      "Runs the `agent` command on startup (requires the Cursor CLI installed and on your PATH).",
    commandLine: "agent",
  },
  {
    id: "claude-code",
    label: "Claude Code",
    description:
      "Runs the `claude` command on startup (requires the Claude Code CLI on your PATH).",
    commandLine: "claude",
  },
];

export function isDefaultAgentCliId(v: string): v is DefaultAgentCliId {
  return DEFAULT_AGENT_CLI_OPTIONS.some((o) => o.id === v);
}

export function parseDefaultAgentCliId(
  raw: string | null,
): DefaultAgentCliId {
  if (raw !== null && isDefaultAgentCliId(raw)) return raw;
  return "none";
}

export function defaultAgentStartupCommand(
  id: DefaultAgentCliId,
): string | null {
  const row = DEFAULT_AGENT_CLI_OPTIONS.find((o) => o.id === id);
  return row?.commandLine ?? null;
}
