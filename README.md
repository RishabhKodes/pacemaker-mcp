## Pacemaker MCP

Model Context Protocol (MCP) server that exposes [Pacemaker](https://clusterlabs.org/pacemaker/) `pcs` commands as safe, guardrailed tools over stdio. It connects to a target cluster node via SSH (key or password auth; optional `sudo`) and runs read-only status queries and controlled operations. Ideal for using Pacemaker safely from MCP-aware clients like Cursor or Claude.

### Features

- **Pacemaker tools**: `pcs_cluster_status`, `pcs_node_status`, `pcs_resource_list`.
- **Logs access**: `pcs_logs_common`, `pcs_logs_tail`, `pcs_logs_journalctl` for Pacemaker/Corosync troubleshooting.
- **Flexible auth**: SSH private key or password; optional `sudo`.
- **Configurable**: environment variables or a JSON/YAML config file.

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

### Configure connection

Using environment variables:

```bash
export PACEMAKER_SSH_HOST=cluster-node.example.com
export PACEMAKER_SSH_USER=ec2-user
export PACEMAKER_SSH_KEY_PATH=~/.ssh/id_rsa
# Optional
export PACEMAKER_SSH_PORT=22
export PACEMAKER_USE_SUDO=true
export PACEMAKER_INSECURE_ACCEPT_UNKNOWN_HOST_KEYS=true
```

Or point to a config file via `PACEMAKER_MCP_CONFIG` (JSON or YAML):

```yaml
default:
  host: cluster-node.example.com
  username: ec2-user
  privateKeyPath: /home/me/.ssh/id_rsa
  sudo: true
clusters:
  prod:
    host: prod-node
    username: hacluster
    privateKeyPath: /home/me/.ssh/prod
    sudo: true
```

Configuration sources are merged in this order (last-wins per field):
- Config file (from `PACEMAKER_MCP_CONFIG` or default search paths)
- Environment variables
- Per-tool arguments (e.g., `host`, `username`, `sudo`)

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
        "PACEMAKER_SSH_HOST": "cluster-node.example.com",
        "PACEMAKER_SSH_USER": "ec2-user",
        "PACEMAKER_SSH_KEY_PATH": "/Users/you/.ssh/id_rsa",
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
        "PACEMAKER_MCP_CONFIG": "/absolute/path/to/pacemaker.yaml"
      }
    }
  }
}
```

Notes:
- Prefer absolute paths in `args` and file-based env like `PACEMAKER_MCP_CONFIG`.
- Configure connection either via env vars or a config file.
- For production, prefer key-based SSH and passwordless `sudo` if `sudo` is required.

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

Each tool accepts a `cluster` name from config or inline SSH params (`host`, `username`, `privateKeyPath`, `sudo`).

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
