## Pacemaker MCP

An MCP server that exposes [Pacemaker](https://clusterlabs.org/pacemaker/) or pcs commands as tools. It connects to a target cluster node over SSH and runs guarded `pcs` commands.

### Features

- **Pacemaker tools**: `pcs_cluster_status`, `pcs_node_status`, `pcs_resource_list`, plus a guarded `pcs_exec`.
- **SSH auth**: private key or password; optional `sudo`.
- **Configurable**: via environment variables or a config file.

### Use in Cursor and Claude (MCP clients)

#### Cursor

1) Build this project so `dist/index.js` exists.

```bash
npm run build
```

2) Edit your global Cursor MCP config and add this server.

On macOS, the file is typically at `~/.cursor/mcp.json`.

Example entry (use absolute paths):

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

Restart Cursor after saving the file.

#### Claude Desktop

1) Build this project so `dist/index.js` exists.

2) Edit the Claude Desktop config to register the server, then restart the app.

On macOS, the file is typically at `~/Library/Application Support/Claude/claude_desktop_config.json`.

Example entry (merge into your existing JSON):

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
- Use absolute paths in `args` and in any file-based env like `PACEMAKER_MCP_CONFIG`.
- You can set connection details via env (as above) or via a config file referenced by `PACEMAKER_MCP_CONFIG`.
- For production, prefer key-based SSH and passwordless `sudo` if `sudo` is required.

### Install and build

```bash
pnpm i || npm i || yarn
npm run build
```

### Quick start with MCP Inspector

```bash
npx @modelcontextprotocol/inspector@latest node $(pwd)/dist/index.js
```

### Configuration

You can configure a default connection with environment variables:

```bash
export PACEMAKER_SSH_HOST=cluster-node.example.com
export PACEMAKER_SSH_USER=ec2-user
export PACEMAKER_SSH_KEY_PATH=~/.ssh/id_rsa
# Optional
export PACEMAKER_SSH_PORT=22
export PACEMAKER_USE_SUDO=true
export PACEMAKER_INSECURE_ACCEPT_UNKNOWN_HOST_KEYS=true
```

Or provide a file via `PACEMAKER_MCP_CONFIG` (JSON or YAML):

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

Configuration sources are merged in the following order (last-wins per-field):
- Config file (selected via `PACEMAKER_MCP_CONFIG` or default search paths)
- Environment variables
- Per-tool arguments (e.g., `host`, `username`, `sudo`)

### Example tool invocations

- `pcs_cluster_status`: returns `pcs cluster status`
- `pcs_node_status`: returns `pcs status nodes`
- `pcs_resource_list`: returns `pcs resource config`
- `pcs_exec`: run a guarded command, e.g. `pcs resource move myres node1`

Each tool accepts a `cluster` name from config or inline SSH params (`host`, `username`, `privateKeyPath`, `sudo`).

### Security considerations

- Prefer key-based SSH; avoid passwords when possible.
- Set `PACEMAKER_INSECURE_ACCEPT_UNKNOWN_HOST_KEYS=false` in production.
- Only use `sudo` if required by your environment.

### Development

```bash
npm run typecheck
npm run build
```

Open with MCP Inspector (from `dist` output):

```bash
npx @modelcontextprotocol/inspector@latest node $(pwd)/dist/index.js
```

See `CONTRIBUTING.md` for PR guidelines.

### License

MIT. See `LICENSE`.
