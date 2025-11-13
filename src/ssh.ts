import { Client, ConnectConfig } from "ssh2";
import { readFile } from "node:fs/promises";
import { ClusterConnectionConfig } from "./config.js";
import os from "node:os";
import path from "node:path";
import { Socket } from "node:net";

export type SshExecResult = {
  stdout: string;
  stderr: string;
  exitCode: number | null;
};

function expandHome(p: string): string {
  if (!p) return p;
  if (p.startsWith("~")) {
    return path.join(os.homedir(), p.slice(1));
  }
  return p;
}

type OpenSshHostConfig = {
  hostName?: string;
  user?: string;
  port?: number;
  identityFiles?: string[];
  strictHostKeyChecking?: string;
  proxyJump?: string;
  proxyCommandRaw?: string;
  proxyJumpIdentityFile?: string;
  userKnownHostsFile?: string;
};

function parseOpenSshConfigForHost(raw: string, alias: string): OpenSshHostConfig | undefined {
  const lines = raw.split(/\r?\n/);
  let inMatch = false;
  let found = false;
  const cfg: OpenSshHostConfig = { identityFiles: [] };

  const isHostLine = (line: string) => /^\s*Host\s+/i.test(line);
  const parseHostTokens = (line: string): string[] => {
    const rest = line.replace(/^\s*Host\s+/i, "").trim();
    return rest.split(/\s+/).filter(Boolean);
  };

  const kv = (line: string): { key: string; value: string } | undefined => {
    const m = /^\s*([A-Za-z][A-Za-z0-9\-]*)\s+(.*)$/.exec(line);
    if (!m) return undefined;
    const key = m[1];
    // Strip inline comments not in quotes (best-effort)
    let value = m[2].trim();
    if (!/^".*"$/.test(value)) {
      const hashIdx = value.indexOf(" #");
      const hashIdx2 = value.indexOf("#");
      const cut = hashIdx >= 0 ? hashIdx : hashIdx2;
      if (cut >= 0) value = value.slice(0, cut).trim();
    }
    // Remove surrounding quotes if present
    value = value.replace(/^"(.*)"$/, "$1");
    return { key: key.toLowerCase(), value };
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    if (isHostLine(line)) {
      if (found) break; // end of the matched block
      const tokens = parseHostTokens(line);
      // Only exact token matches; ignore wildcards for simplicity
      inMatch = tokens.some((t) => t === alias);
      continue;
    }
    if (!inMatch) continue;
    const pair = kv(line);
    if (!pair) continue;
    found = true;
    switch (pair.key) {
      case "hostname":
        cfg.hostName = pair.value;
        break;
      case "user":
        cfg.user = pair.value;
        break;
      case "port": {
        const n = Number(pair.value);
        if (!Number.isNaN(n)) cfg.port = n;
        break;
      }
      case "identityfile":
        if (!cfg.identityFiles) cfg.identityFiles = [];
        cfg.identityFiles.push(pair.value);
        break;
      case "stricthostkeychecking":
        cfg.strictHostKeyChecking = pair.value.toLowerCase();
        break;
      case "userknownhostsfile":
        cfg.userKnownHostsFile = pair.value;
        break;
      case "proxyjump":
        cfg.proxyJump = pair.value;
        break;
      case "proxycommand":
        cfg.proxyCommandRaw = pair.value;
        // Best-effort translate common 'ssh -W %h:%p <alias> [-i key] [-o ...]' to ProxyJump and capture identity
        // Tokenize respecting simple quotes
        {
          const tokens = pair.value.match(/(?:[^\s"]+|"[^"]*")+/g) || [];
          const isSSH = tokens[0] === "ssh" || tokens[0]?.endsWith("/ssh");
          const wIndex = tokens.findIndex((t) => t === "-W");
          if (isSSH && wIndex >= 0 && tokens[wIndex + 1] === "%h:%p") {
            // Look for destination token after %h:%p
            const dest = tokens[wIndex + 2];
            if (dest) {
              // Strip quotes if present
              const destStr = dest.replace(/^"(.*)"$/, "$1");
              cfg.proxyJump = destStr;
            }
            const iIndex = tokens.findIndex((t) => t === "-i");
            if (iIndex >= 0 && tokens[iIndex + 1]) {
              const idPath = tokens[iIndex + 1].replace(/^"(.*)"$/, "$1");
              cfg.proxyJumpIdentityFile = idPath;
            }
            // If -o StrictHostKeyChecking=no or -o UserKnownHostsFile=/dev/null present, we will relax at hop
          }
        }
        break;
      default:
        break;
    }
  }

  if (!found) return undefined;
  return cfg;
}

export async function runSshCommand(
  cfg: ClusterConnectionConfig,
  command: string,
  timeoutMs: number | undefined
): Promise<SshExecResult> {
  if (!cfg.sshConfigHost) {
    throw new Error("sshConfigHost is required. Set an OpenSSH Host alias to connect.");
  }

  const sshCfgPath = expandHome(cfg.sshConfigPath || path.join(os.homedir(), ".ssh", "config"));
  const sshRaw = await readFile(sshCfgPath, "utf8").catch((e) => {
    throw new Error(`Failed to load OpenSSH config from ${sshCfgPath}: ${(e as Error).message}`);
  });
  const parsed = parseOpenSshConfigForHost(sshRaw, cfg.sshConfigHost);
  if (!parsed) {
    throw new Error(`Host '${cfg.sshConfigHost}' not found in ${sshCfgPath}`);
  }
  const identity = parsed.identityFiles && parsed.identityFiles.length ? expandHome(parsed.identityFiles[0]) : undefined;
  if (!parsed.hostName) {
    throw new Error(`Incomplete SSH config for Host '${cfg.sshConfigHost}': require HostName`);
  }
  const defaultUser = process.env.USER || process.env.LOGNAME || os.userInfo().username;
  const resolvedUser = parsed.user || defaultUser;
  const enableDebug = String(process.env.PACEMAKER_SSH_DEBUG || "").trim().toLowerCase() === "true";

  const connection: ConnectConfig = {
    host: parsed.hostName,
    port: parsed.port ?? 22,
    username: resolvedUser,
    readyTimeout: cfg.readyTimeoutMs ?? 15000,
    tryKeyboard: false,
    ...(enableDebug ? { debug: (msg: string) => console.error(`[ssh2] ${msg}`) } : {}),
  };

  if (identity) {
    connection.privateKey = await readFile(identity);
  } else if (process.env.SSH_AUTH_SOCK) {
    connection.agent = process.env.SSH_AUTH_SOCK;
  } // password auth is intentionally not supported in simplified mode

  // Relax host key verification if explicitly configured or implied by StrictHostKeyChecking no
  const relaxByConfig = cfg.insecureAcceptUnknownHostKeys === true;
  const relaxBySshConfig =
    (parsed.strictHostKeyChecking === "no" ||
      (parsed.userKnownHostsFile && parsed.userKnownHostsFile === "/dev/null")) &&
    cfg.insecureAcceptUnknownHostKeys !== false;
  if (relaxByConfig || relaxBySshConfig) {
    connection.hostVerifier = () => true;
  }

  const connectClient = (connectCfg: ConnectConfig): Promise<Client> => {
    return new Promise<Client>((resolve, reject) => {
      const c = new Client();
      c.on("ready", () => resolve(c))
        .on("error", (err) => reject(err))
        .connect(connectCfg);
    });
  };

  const forwardViaJump = async (targetHost: string, targetPort: number): Promise<{ jump: Client; sock: Socket }> => {
    if (!parsed.proxyJump) {
      throw new Error("ProxyJump not specified");
    }
    // Only support first hop and only alias or user@alias forms
    const firstHop = parsed.proxyJump.split(",")[0].trim();
    const atIdx = firstHop.indexOf("@");
    const hopAlias = atIdx >= 0 ? firstHop.slice(atIdx + 1) : firstHop;
    const hopUserOverride = atIdx >= 0 ? firstHop.slice(0, atIdx) : undefined;
    const hopParsed = parseOpenSshConfigForHost(sshRaw, hopAlias);
    if (!hopParsed) {
      throw new Error(`ProxyJump alias '${hopAlias}' not found in ${sshCfgPath}`);
    }
    if (!hopParsed.hostName) {
      throw new Error(`Incomplete SSH config for ProxyJump '${hopAlias}': require HostName`);
    }
    // Prefer identity from ProxyCommand '-i' if present, else hop alias config
    const hopIdentity =
      parsed.proxyJumpIdentityFile
        ? expandHome(parsed.proxyJumpIdentityFile)
        : hopParsed.identityFiles && hopParsed.identityFiles.length
        ? expandHome(hopParsed.identityFiles[0])
        : undefined;
    const hopUser = hopUserOverride || hopParsed.user || defaultUser;
    const hopConn: ConnectConfig = {
      host: hopParsed.hostName,
      port: hopParsed.port ?? 22,
      username: hopUser,
      readyTimeout: cfg.readyTimeoutMs ?? 15000,
      tryKeyboard: false,
      ...(enableDebug ? { debug: (msg: string) => console.error(`[ssh2-hop] ${msg}`) } : {}),
    };
    if (hopIdentity) {
      hopConn.privateKey = await readFile(hopIdentity);
    } else if (process.env.SSH_AUTH_SOCK) {
      hopConn.agent = process.env.SSH_AUTH_SOCK;
    }
    const relaxHop =
      (hopParsed.strictHostKeyChecking === "no" ||
        (hopParsed.userKnownHostsFile && hopParsed.userKnownHostsFile === "/dev/null")) &&
      cfg.insecureAcceptUnknownHostKeys !== false;
    if (cfg.insecureAcceptUnknownHostKeys === true || relaxHop) {
      hopConn.hostVerifier = () => true;
    }
    const jump = await connectClient(hopConn);
    const sock: Socket = await new Promise<Socket>((resolve, reject) => {
      jump.forwardOut("127.0.0.1", 0, targetHost, targetPort, (err, stream) => {
        if (err) return reject(err);
        resolve(stream as unknown as Socket);
      });
    });
    return { jump, sock };
  };

  return new Promise<SshExecResult>(async (resolve, reject) => {
    let timer: NodeJS.Timeout | undefined;
    let jumpClient: Client | undefined;
    let targetClient: Client | undefined;

    const clear = () => {
      if (timer) clearTimeout(timer);
    };

    if (timeoutMs && timeoutMs > 0) {
      timer = setTimeout(() => {
        try {
          if (targetClient) targetClient.end();
        } catch {}
        try {
          if (jumpClient) jumpClient.end();
        } catch {}
        reject(new Error(`SSH command timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    }

    try {
      if (parsed.proxyJump) {
        const { jump, sock } = await forwardViaJump(connection.host as string, connection.port as number);
        jumpClient = jump;
        const targetConn: ConnectConfig = {
          sock,
          username: connection.username,
          readyTimeout: connection.readyTimeout,
          tryKeyboard: false,
          ...(enableDebug ? { debug: (msg: string) => console.error(`[ssh2-target] ${msg}`) } : {}),
        };
        if (connection.privateKey) {
          targetConn.privateKey = connection.privateKey;
        } else if (connection.agent) {
          targetConn.agent = connection.agent;
        }
        if (connection.hostVerifier) {
          targetConn.hostVerifier = connection.hostVerifier;
        }
        targetClient = await connectClient(targetConn);
      } else {
        targetClient = await connectClient(connection);
      }
      const conn = targetClient;
      conn.exec(command, (err, stream) => {
        if (err) {
          clear();
          try { conn.end(); } catch {}
          try { if (jumpClient) jumpClient.end(); } catch {}
          reject(err);
          return;
        }
        let stdout = "";
        let stderr = "";
        let exitCode: number | null = null;

        stream
          .on("close", (code: number | null) => {
            exitCode = code;
            clear();
            try { conn.end(); } catch {}
            try { if (jumpClient) jumpClient.end(); } catch {}
            resolve({ stdout, stderr, exitCode });
          })
          .on("data", (data: Buffer) => {
            stdout += data.toString();
          });

        stream.stderr.on("data", (data: Buffer) => {
          stderr += data.toString();
        });
      });
    } catch (err) {
      clear();
      try { if (targetClient) targetClient.end(); } catch {}
      try { if (jumpClient) jumpClient.end(); } catch {}
      reject(err as Error);
    }
  });
}


