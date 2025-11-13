import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import YAML from "yaml";

export type ClusterConnectionConfig = {
  // Single connection method: OpenSSH config alias
  port?: number;
  privateKeyPath?: string;
  password?: string;
  passphrase?: string;
  sudo?: boolean;
  insecureAcceptUnknownHostKeys?: boolean;
  readyTimeoutMs?: number;
  // Optional OpenSSH config integration
  sshConfigPath?: string;
  sshConfigHost?: string;
};

export type PacemakerServerConfig = {
  default?: ClusterConnectionConfig;
  clusters?: Record<string, ClusterConnectionConfig>;
};

async function readConfigFile(configPath: string): Promise<PacemakerServerConfig | undefined> {
  if (!existsSync(configPath)) return undefined;
  const raw = await readFile(configPath, "utf8");
  if (configPath.endsWith(".yaml") || configPath.endsWith(".yml")) {
    return YAML.parse(raw) as PacemakerServerConfig;
  }
  return JSON.parse(raw) as PacemakerServerConfig;
}

export async function loadConfig(): Promise<PacemakerServerConfig> {
  const envPath = process.env.PACEMAKER_MCP_CONFIG;
  const defaultPaths = [
    envPath,
    path.join(process.cwd(), "config", "pacemaker.json"),
    path.join(process.cwd(), "config", "pacemaker.yaml"),
    path.join(os.homedir(), ".config", "pacemaker-mcp", "config.yaml"),
  ].filter(Boolean) as string[];

  for (const p of defaultPaths) {
    const conf = await readConfigFile(p).catch(() => undefined);
    if (conf) {
      // Merge environment defaults on top of file config (env wins)
      const envConf = envToClusterConfig();
      if (envConf) {
        return {
          default: mergeConfig(conf.default, envConf),
          clusters: conf.clusters,
        };
      }
      return conf;
    }
  }

  // Fallback to env-only config
  return {
    default: envToClusterConfig(),
  };
}

export function envToClusterConfig(): ClusterConnectionConfig | undefined {
  const sshConfigPath = process.env.PACEMAKER_SSH_CONFIG_PATH;
  const sshConfigHost = process.env.PACEMAKER_SSH_CONFIG_HOST || process.env.PACEMAKER_SSH_HOST_ALIAS;
  if (!sshConfigHost) return undefined;
  const port = process.env.PACEMAKER_SSH_PORT ? Number(process.env.PACEMAKER_SSH_PORT) : undefined;
  const privateKeyPath = process.env.PACEMAKER_SSH_KEY_PATH;
  const password = process.env.PACEMAKER_SSH_PASSWORD;
  const passphrase = process.env.PACEMAKER_SSH_KEY_PASSPHRASE;
  const sudo = toBool(process.env.PACEMAKER_USE_SUDO, false);
  const insecureAcceptUnknownHostKeys = toBool(process.env.PACEMAKER_INSECURE_ACCEPT_UNKNOWN_HOST_KEYS, true);
  const readyTimeoutMs = process.env.PACEMAKER_SSH_READY_TIMEOUT_MS ? Number(process.env.PACEMAKER_SSH_READY_TIMEOUT_MS) : undefined;
  return { port, privateKeyPath, password, passphrase, sudo, insecureAcceptUnknownHostKeys, readyTimeoutMs, sshConfigPath, sshConfigHost };
}

export function mergeConfig(base: ClusterConnectionConfig | undefined, override: Partial<ClusterConnectionConfig> | undefined): ClusterConnectionConfig | undefined {
  if (!base && !override) return undefined;
  // Only apply override properties that are explicitly defined, so we don't
  // accidentally clobber values from base (e.g., env-config) with undefined.
  const cleanedOverride = Object.fromEntries(
    Object.entries(override || {}).filter(([, value]) => value !== undefined)
  ) as Partial<ClusterConnectionConfig>;
  return { ...(base || {}), ...cleanedOverride } as ClusterConnectionConfig;
}

function toBool(value: string | undefined, defaultValue: boolean): boolean {
  if (value == null) return defaultValue;
  const v = value.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}


