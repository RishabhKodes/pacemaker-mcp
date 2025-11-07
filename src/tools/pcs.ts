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

// ToolSpec type definition for MCP tools
export type ToolSpec = {
  name: string;
  description?: string;
  inputSchema: { type: "object"; properties?: Record<string, unknown>; required?: string[] };
  handler: (args: any) => Promise<{ content: Array<{ type: "text"; text: string }> }>;
};

// Common properties for all pcs tools
const commonProperties: Record<string, unknown> = {
  cluster: { type: "string", description: "Named cluster in config" },
  host: { type: "string" },
  username: { type: "string" },
  port: { type: "number" },
  privateKeyPath: { type: "string" },
  password: { type: "string" },
  passphrase: { type: "string" },
  sudo: { type: "boolean", description: "Prefix commands with sudo on the remote host" },
  timeoutMs: { type: "number", description: "SSH command timeout in milliseconds" },
};

function makeTool(
  name: string,
  description: string,
  extraProperties: Record<string, unknown> | undefined,
  required: string[] | undefined,
  build: (args: any, conn: ClusterConnectionConfig) => string
): ToolSpec {
  return {
    name,
    description,
    inputSchema: {
      type: "object",
      properties: { ...commonProperties, ...(extraProperties || {}) },
      ...(required && required.length ? { required } : {}),
    },
    handler: async (args: any) => {
      const conn = await resolveConnection(args);
      const raw = build(args, conn);
      const command = buildCommand(raw, conn.sudo);
      const { stdout, stderr, exitCode } = await runSshCommand(conn, command, args.timeoutMs);
      const text = formatResult(command, stdout, stderr, exitCode);
      return { content: [{ type: "text", text }] };
    },
  };
}

export function getPcsTools(): ToolSpec[] {
  const tools: ToolSpec[] = [];

  tools.push({
    name: "pcs_cluster_status",
    description:
      "Displays high-level cluster state using 'pcs cluster status'. Useful for quick health checks: shows whether Pacemaker is running, node membership, fencing/stonith state, and manager health.",
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
    description:
      "Shows node states using 'pcs status nodes'. Lists each node and whether it is online/offline, standby, maintenance, or otherwise unavailable.",
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
      const command = buildCommand("pcs status nodes", conn.sudo);
      const { stdout, stderr, exitCode } = await runSshCommand(conn, command, args.timeoutMs);
      const text = formatResult(command, stdout, stderr, exitCode);
      return { content: [{ type: "text", text }] };
    },
  });

  tools.push({
    name: "pcs_resource_list",
    description:
      "Shows full resource configuration using 'pcs resource config'. Includes agents, parameters, operations, meta-attributes, groups, and ordering/colocation metadata for troubleshooting and audits.",
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
      const command = buildCommand("pcs resource config", conn.sudo);
      const { stdout, stderr, exitCode } = await runSshCommand(conn, command, args.timeoutMs);
      const text = formatResult(command, stdout, stderr, exitCode);
      return { content: [{ type: "text", text }] };
    },
  });

  // General status tools
  tools.push(
    makeTool(
      "pcs_status",
      "Overall cluster status via 'pcs status': summarizes nodes, resources, failures, and constraints.",
      undefined,
      undefined,
      () => "pcs status"
    )
  );

  tools.push(
    makeTool(
      "pcs_status_resources",
      "Resource runtime state via 'pcs status resources': shows which resources are started/stopped and on which nodes.",
      undefined,
      undefined,
      () => "pcs status resources"
    )
  );

  tools.push(
    makeTool(
      "pcs_status_xml",
      "Cluster status in XML via 'pcs status xml' for programmatic parsing and deeper diagnostics.",
      undefined,
      undefined,
      () => "pcs status xml"
    )
  );

  tools.push(
    makeTool(
      "pcs_status_full",
      "Full cluster configuration and runtime details via 'pcs status --full'. Includes nodes, resources, failures, options, constraints, and history useful for audits and deep troubleshooting.",
      undefined,
      undefined,
      () => "pcs status --full"
    )
  );

  // Cluster / node management
  tools.push(
    makeTool(
      "pcs_cluster_start",
      "Start the cluster stack on the node via 'pcs cluster start'.",
      undefined,
      undefined,
      () => "pcs cluster start"
    )
  );

  tools.push(
    makeTool(
      "pcs_cluster_stop",
      "Stop the cluster stack on the node via 'pcs cluster stop'.",
      undefined,
      undefined,
      () => "pcs cluster stop"
    )
  );

  tools.push(
    makeTool(
      "pcs_node_standby",
      "Put a node in standby (no resources run there) via 'pcs node standby [<node>]'.",
      { node: { type: "string", description: "Target node name; omit to affect the local node" } },
      undefined,
      (args) => (args.node ? `pcs node standby ${args.node}` : "pcs node standby")
    )
  );

  tools.push(
    makeTool(
      "pcs_node_unstandby",
      "Bring a node out of standby via 'pcs node unstandby [<node>]'.",
      { node: { type: "string", description: "Target node name; omit to affect the local node" } },
      undefined,
      (args) => (args.node ? `pcs node unstandby ${args.node}` : "pcs node unstandby")
    )
  );

  // Configuration visibility
  tools.push(
    makeTool(
      "pcs_constraint_list",
      "List all constraints via 'pcs constraint config' including ordering and colocation.",
      undefined,
      undefined,
      () => "pcs constraint config"
    )
  );

  tools.push(
    makeTool(
      "pcs_property_list",
      "List cluster properties via 'pcs property list --all' for tuning and defaults.",
      undefined,
      undefined,
      () => "pcs property list --all"
    )
  );

  tools.push(
    makeTool(
      "pcs_stonith_show",
      "Show stonith/fencing devices via 'pcs stonith show' including configuration and parameters.",
      undefined,
      undefined,
      () => "pcs stonith status"
    )
  );

  // Resource management
  tools.push(
    makeTool(
      "pcs_resource_enable",
      "Enable a resource or all resources via 'pcs resource enable <id>' or '--all'.",
      {
        resource: { type: "string", description: "Resource ID to enable" },
        all: { type: "boolean", description: "Enable all resources" },
      },
      undefined,
      (args) => {
        if (args.all) return "pcs resource enable --all";
        if (args.resource) return `pcs resource enable ${args.resource}`;
        throw new McpError(ErrorCode.InvalidParams, "Provide either 'resource' or set 'all'=true");
      }
    )
  );

  tools.push(
    makeTool(
      "pcs_resource_disable",
      "Disable a resource or all resources via 'pcs resource disable <id>' or '--all'.",
      {
        resource: { type: "string", description: "Resource ID to disable" },
        all: { type: "boolean", description: "Disable all resources" },
      },
      undefined,
      (args) => {
        if (args.all) return "pcs resource disable --all";
        if (args.resource) return `pcs resource disable ${args.resource}`;
        throw new McpError(ErrorCode.InvalidParams, "Provide either 'resource' or set 'all'=true");
      }
    )
  );

  tools.push(
    makeTool(
      "pcs_resource_move",
      "Create a temporary location constraint via 'pcs resource move <id> [<node>]'.",
      {
        resource: { type: "string", description: "Resource ID to move" },
        node: { type: "string", description: "Preferred target node (optional)" },
      },
      ["resource"],
      (args) => (args.node ? `pcs resource move ${args.resource} ${args.node}` : `pcs resource move ${args.resource}`)
    )
  );

  tools.push(
    makeTool(
      "pcs_resource_clear",
      "Clear temporary constraints and failures for a resource via 'pcs resource clear <id>'.",
      { resource: { type: "string", description: "Resource ID to clear" } },
      ["resource"],
      (args) => `pcs resource clear ${args.resource}`
    )
  );

  tools.push(
    makeTool(
      "pcs_resource_cleanup",
      "Run cleanup on a resource (or all) via 'pcs resource cleanup [<id>]'.",
      { resource: { type: "string", description: "Optional resource ID; omit to clean all" } },
      undefined,
      (args) => (args.resource ? `pcs resource cleanup ${args.resource}` : "pcs resource cleanup")
    )
  );

  tools.push(
    makeTool(
      "pcs_resource_ban",
      "Ban a resource from a node via 'pcs resource ban <id> <node> [lifetime]'.",
      {
        resource: { type: "string", description: "Resource ID to ban" },
        node: { type: "string", description: "Node to ban the resource from" },
        lifetime: { type: "string", description: "Optional lifetime (e.g. 'PT1H' or 'inf')" },
      },
      ["resource", "node"],
      (args) =>
        args.lifetime
          ? `pcs resource ban ${args.resource} ${args.node} ${args.lifetime}`
          : `pcs resource ban ${args.resource} ${args.node}`
    )
  );

  tools.push(
    makeTool(
      "pcs_resource_unban",
      "Remove a ban for a resource via 'pcs resource unban <id> [<node>]'.",
      {
        resource: { type: "string", description: "Resource ID to unban" },
        node: { type: "string", description: "Optional node; omit to unban everywhere" },
      },
      ["resource"],
      (args) => (args.node ? `pcs resource unban ${args.resource} ${args.node}` : `pcs resource unban ${args.resource}`)
    )
  );

  tools.push(
    makeTool(
      "pcs_resource_restart",
      "Restart a resource via 'pcs resource restart <id>' or all resources if omitted (agent-dependent).",
      { resource: { type: "string", description: "Optional resource ID to restart" } },
      undefined,
      (args) => (args.resource ? `pcs resource restart ${args.resource}` : "pcs resource restart")
    )
  );

  tools.push(
    makeTool(
      "pcs_resource_config",
      "Show the configured definition for a specific resource via 'pcs resource config <id>'. Includes agent, parameters, operations, and meta-attributes for that resource only.",
      { resource: { type: "string", description: "Resource ID to show config for" } },
      ["resource"],
      (args) => `pcs resource config ${args.resource}`
    )
  );

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


