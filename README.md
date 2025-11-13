## Pacemaker MCP

Model Context Protocol (MCP) server that exposes [Pacemaker](https://clusterlabs.org/pacemaker/) `pcs` commands as safe, guardrailed tools over stdio. It connects to a target cluster node via SSH using your OpenSSH config (Host alias; optional `sudo`) and runs read-only status queries and controlled operations. Ideal for using Pacemaker safely from MCP-aware clients like Cursor or Claude.

### Features

- **Pacemaker tools**: `pcs_cluster_status`, `pcs_node_status`, `pcs_resource_list`.
- **Logs access**: `pcs_logs_common`, `pcs_logs_tail`, `pcs_logs_journalctl` for Pacemaker/Corosync troubleshooting.
- **Key-based auth via OpenSSH config**: uses your `~/.ssh/config` Host alias; optional `sudo`.
- **Configurable**: JSON/YAML config file or environment variables for alias and options.

### Requirements

- Node.js >= 18
- Access to a Pacemaker cluster node over SSH

### Setup (from scratch)

```bash
# 1) Install dependencies
npm install

# 2) Build the server (emits dist/index.js)
npm run build

# 3) (Optional) Verify locally with MCP Inspector
npx @modelcontextprotocol/inspector@latest node $(pwd)/dist/index.js
```

You can also run directly with Node:

```bash
node dist/index.js
```

### Configure connection (single method)

Use your OpenSSH config (e.g., `~/.ssh/config`) with a Host alias, and reference that alias. This is the only connection method used by the server.

- Set a Host entry in your OpenSSH config file:

```
Host my-cluster
  HostName cluster-node.example.com
  User ec2-user
  IdentityFile ~/.ssh/id_rsa
  Port 22
```

- If you use a bastion, either define it with ProxyJump or a ProxyCommand (both are supported):

```
Host my-cluster
  HostName 10.1.30.239
  User root
  IdentityFile ~/.ssh/aws-instance_rsa
  StrictHostKeyChecking no
  UserKnownHostsFile /dev/null
  # Option A (preferred): use a Host alias for the bastion
  # ProxyJump bastion
  # Option B: ProxyCommand (will be auto-translated)
  ProxyCommand ssh -W %h:%p bastion -i ~/.ssh/aws-bastion_rsa -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null

Host bastion
  HostName bastion.example.com
  User ec2-user
  IdentityFile ~/.ssh/aws-bastion_rsa
```

- Then either:
  - Provide alias per-call as args: `sshConfigHost: "my-cluster"` (and optionally `sshConfigPath` if not `~/.ssh/config`)
  - Or put it in your Pacemaker MCP config file (JSON/YAML) via `PACEMAKER_MCP_CONFIG`:

```yaml
default:
  sshConfigHost: my-cluster
  # sshConfigPath: /absolute/path/to/ssh_config   # optional, defaults to ~/.ssh/config
  sudo: true
```

Notes:
- This server reads connection parameters exclusively from the OpenSSH alias (HostName, User, Port, IdentityFile).
- If your ssh config has `StrictHostKeyChecking no` for the alias, unknown host keys will be accepted unless overridden.
- ProxyCommand lines like `ssh -W %h:%p <jump> -i <key> ...` are supported; they are treated as a single-hop ProxyJump automatically.
- If `IdentityFile` is not set, the SSH agent (`SSH_AUTH_SOCK`) is used if available.
- If `User` is not set, your local username is used by default.

Configuration sources (last-wins per field):
- Config file from `PACEMAKER_MCP_CONFIG` (or default search paths)
- Environment variables (e.g., `PACEMAKER_SSH_CONFIG_HOST`, `PACEMAKER_USE_SUDO`)
- Per-tool arguments (`sshConfigHost`, `sshConfigPath`, `sudo`)

### Use with MCP clients

#### Cursor

1) Build so `dist/index.js` exists: `npm run build`

2) Add the server to your global Cursor MCP config (macOS: `~/.cursor/mcp.json`). Use absolute paths.

```json
{
  "mcpServers": {
    "pacemaker-mcp-server": {
      "command": "node",
      "args": ["/absolute/path/to/pcs_mcp/dist/index.js"],
      "env": {
        "PACEMAKER_SSH_CONFIG_HOST": "my-cluster",
        "PACEMAKER_USE_SUDO": "true"
      }
    }
  }
}
```

Restart Cursor after saving.

#### Claude Desktop

1) Build `dist/index.js`: `npm run build`

2) Add the server to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS), then restart Claude. Use absolute paths.

```json
{
  "mcpServers": {
    "pacemaker-mcp-server": {
      "command": "node",
      "args": ["/absolute/path/to/pcs_mcp/dist/index.js"],
      "env": {
        "PACEMAKER_MCP_CONFIG": "/absolute/path/to/pacemaker.yaml",
        "PACEMAKER_SSH_CONFIG_HOST": "my-cluster",
        "PACEMAKER_USE_SUDO": "false",
        "PACEMAKER_SSH_READY_TIMEOUT_MS": "30000"
      }
    }
  }
}
```

Notes:
- Prefer absolute paths in `args` and file-based env like `PACEMAKER_MCP_CONFIG`.
- Configure connection via OpenSSH Host alias; set the alias through env or your MCP config file.
- For production, prefer key-based SSH and passwordless `sudo` if `sudo` is required.

### Troubleshooting

- Handshake timeout:
  - Set `PACEMAKER_SSH_DEBUG=true` and retry; inspect logs for where it stalls (jump vs target vs auth).
  - Increase `PACEMAKER_SSH_READY_TIMEOUT_MS` (e.g., `30000`).
  - Verify your alias works in a terminal: `ssh my-cluster 'echo ok'`.
  - If using a bastion, ensure `ProxyJump` or a correct `ProxyCommand` is defined and keys are accessible.
  - If host key checks block you in dev/test, set `StrictHostKeyChecking no` and `UserKnownHostsFile /dev/null` in your SSH config or set `PACEMAKER_INSECURE_ACCEPT_UNKNOWN_HOST_KEYS=true`.

### Available tools (examples)

- `pcs_cluster_status`: returns `pcs cluster status`
- `pcs_node_status`: returns `pcs status nodes`
- `pcs_resource_list`: returns `pcs resource config`
- `pcs_logs_common`: tail common log files and optionally journal; e.g., last 200 lines of Pacemaker/Corosync logs
  - args: `{ "lines": 200, "includeJournal": true }`
- `pcs_logs_tail`: tail specific log files
  - args: `{ "paths": ["/var/log/pacemaker/pacemaker.log", "/var/log/cluster/corosync.log"], "lines": 500 }`
- `pcs_logs_journalctl`: read journal for units (defaults to pacemaker and corosync)
  - args: `{ "units": ["pacemaker", "corosync"], "lines": 300, "since": "2 hours ago", "priority": "warning", "grep": "fail|error" }`

Each tool accepts a `cluster` name from config or `sshConfigHost`/`sshConfigPath`, and `sudo`.

### Security considerations

- Prefer key-based SSH; avoid passwords when possible.
- Set `PACEMAKER_INSECURE_ACCEPT_UNKNOWN_HOST_KEYS=false` in production.
- Only use `sudo` if required by your environment.

### Development

```bash
npm run typecheck
npm run build
# Run from TS directly (dev):
npm run dev
```

Open with MCP Inspector (from `dist` output):

```bash
npx @modelcontextprotocol/inspector@latest node $(pwd)/dist/index.js
```

See `CONTRIBUTING.md` for PR guidelines.

### License

MIT. See `LICENSE`.
