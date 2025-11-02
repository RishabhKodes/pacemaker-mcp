import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import { ClusterConnectionConfig, loadConfig, mergeConfig } from "../config.js";
import { runSshCommand } from "../ssh.js";

type CommonInput = {
  cluster?: string;
  host?: string;
  username?: string;
  port?: number;
  privateKeyPath?: string;
  password?: string;
  passphrase?: string;
  sudo?: boolean;
  timeoutMs?: number;
};

async function resolveConnection(input: CommonInput): Promise<ClusterConnectionConfig> {
  const globalConfig = await loadConfig();
  const base = input.cluster ? globalConfig.clusters?.[input.cluster] : globalConfig.default;
  const override: Partial<ClusterConnectionConfig> = {
    host: input.host,
    username: input.username,
    port: input.port,
    privateKeyPath: input.privateKeyPath,
    password: input.password,
    passphrase: input.passphrase,
    sudo: input.sudo,
  };
  const conf = mergeConfig(base, override);
  if (!conf?.host || !conf.username) {
    throw new McpError(ErrorCode.InvalidParams, "Missing SSH host/username; provide via args, env, or config file");
  }
  return conf;
}

function buildCommand(raw: string, sudo?: boolean): string {
  const cmd = raw.trim();
  if (sudo) return `sudo ${cmd}`;
  return cmd;
}

export type ToolSpec = {
  name: string;
  description?: string;
  inputSchema: { type: "object"; properties?: Record<string, unknown>; required?: string[] };
  handler: (args: any) => Promise<{ content: Array<{ type: "text"; text: string }> }>;
};

export function getPcsTools(): ToolSpec[] {
  const tools: ToolSpec[] = [];

  tools.push({
    name: "pcs_cluster_status",
    description: "Run 'pcs cluster status' on the target Pacemaker node via SSH and return text output.",
    inputSchema: {
      type: "object",
      properties: {
        cluster: { type: "string", description: "Named cluster in config" },
        host: { type: "string" },
        username: { type: "string" },
        port: { type: "number" },
        privateKeyPath: { type: "string" },
        password: { type: "string" },
        passphrase: { type: "string" },
        sudo: { type: "boolean" },
        timeoutMs: { type: "number" },
      },
    },
    handler: async (args: CommonInput) => {
      const conn = await resolveConnection(args);
      const command = buildCommand("pcs cluster status", conn.sudo);
      const { stdout, stderr, exitCode } = await runSshCommand(conn, command, args.timeoutMs);
      const text = formatResult(command, stdout, stderr, exitCode);
      return { content: [{ type: "text", text }] };
    },
  });

  tools.push({
    name: "pcs_node_status",
    description: "Run 'pcs node status' and return text output.",
    inputSchema: {
      type: "object",
      properties: {
        cluster: { type: "string" },
        host: { type: "string" },
        username: { type: "string" },
        port: { type: "number" },
        privateKeyPath: { type: "string" },
        password: { type: "string" },
        passphrase: { type: "string" },
        sudo: { type: "boolean" },
        timeoutMs: { type: "number" },
      },
    },
    handler: async (args: CommonInput) => {
      const conn = await resolveConnection(args);
      const command = buildCommand("pcs node status", conn.sudo);
      const { stdout, stderr, exitCode } = await runSshCommand(conn, command, args.timeoutMs);
      const text = formatResult(command, stdout, stderr, exitCode);
      return { content: [{ type: "text", text }] };
    },
  });

  tools.push({
    name: "pcs_resource_list",
    description: "Run 'pcs resource show --full' and return text output with resources and groups.",
    inputSchema: {
      type: "object",
      properties: {
        cluster: { type: "string" },
        host: { type: "string" },
        username: { type: "string" },
        port: { type: "number" },
        privateKeyPath: { type: "string" },
        password: { type: "string" },
        passphrase: { type: "string" },
        sudo: { type: "boolean" },
        timeoutMs: { type: "number" },
      },
    },
    handler: async (args: CommonInput) => {
      const conn = await resolveConnection(args);
      const command = buildCommand("pcs resource show --full", conn.sudo);
      const { stdout, stderr, exitCode } = await runSshCommand(conn, command, args.timeoutMs);
      const text = formatResult(command, stdout, stderr, exitCode);
      return { content: [{ type: "text", text }] };
    },
  });

  tools.push({
    name: "pcs_exec",
    description: "Execute a specific 'pcs' command with arguments (safeguarded).",
    inputSchema: {
      type: "object",
      properties: {
        cluster: { type: "string" },
        host: { type: "string" },
        username: { type: "string" },
        port: { type: "number" },
        privateKeyPath: { type: "string" },
        password: { type: "string" },
        passphrase: { type: "string" },
        sudo: { type: "boolean" },
        timeoutMs: { type: "number" },
        command: { type: "string", description: "Command string starting with 'pcs '" },
      },
      required: ["command"],
    },
    handler: async (args: CommonInput & { command: string }) => {
      const cmd = (args.command || "").trim();
      if (!/^pcs\s/.test(cmd)) {
        throw new McpError(ErrorCode.InvalidParams, "Only 'pcs' commands are permitted.");
      }
      const conn = await resolveConnection(args);
      const command = buildCommand(cmd, conn.sudo);
      const { stdout, stderr, exitCode } = await runSshCommand(conn, command, args.timeoutMs);
      const text = formatResult(command, stdout, stderr, exitCode);
      return { content: [{ type: "text", text }] };
    },
  });

  return tools;
}

function formatResult(command: string, stdout: string, stderr: string, exitCode: number | null): string {
  const lines: string[] = [];
  lines.push(`$ ${command}`);
  if (stdout.trim()) {
    lines.push("\nSTDOUT:\n" + stdout.trim());
  }
  if (stderr.trim()) {
    lines.push("\nSTDERR:\n" + stderr.trim());
  }
  lines.push(`\nExit code: ${exitCode ?? "null"}`);
  return lines.join("\n");
}


