## pcs_mcp

An MCP server that exposes Pacemaker/pcs commands as tools. It connects to a target cluster node over SSH and runs guarded `pcs` commands.

### Features

- MCP tools for common Pacemaker operations: `pcs_cluster_status`, `pcs_node_status`, `pcs_resource_list`, and a guarded `pcs_exec`.
- SSH authentication via private key or password; optional `sudo` support.
- Configurable via environment variables or a config file.

### Install and build

```bash
pnpm i || npm i || yarn
pnpm build || npm run build || yarn build
```

### Run with MCP Inspector

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

### Example Tool Invocations

- `pcs_cluster_status`: returns `pcs cluster status` output
- `pcs_node_status`: returns `pcs node status` output
- `pcs_resource_list`: returns `pcs resource show --full` output
- `pcs_exec`: run a specific command, e.g. `pcs resource move myres node1` (guarded to `pcs` prefix)

Each tool accepts either a `cluster` name from config or inline SSH params (e.g., `host`, `username`, `privateKeyPath`, `sudo`).

### Notes

- Start simple: outputs are returned as plain text. If you need structured data, we can add `crm_mon -1 -r -X` parsing and present JSON in a follow-up.
- This server is similar in spirit to the Kubernetes MCP server, but targets `pcs` via SSH instead of Kubernetes API servers.
