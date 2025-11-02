import { Client, ConnectConfig } from "ssh2";
import { readFile } from "node:fs/promises";
import { ClusterConnectionConfig } from "./config.js";

export type SshExecResult = {
  stdout: string;
  stderr: string;
  exitCode: number | null;
};

export async function runSshCommand(
  cfg: ClusterConnectionConfig,
  command: string,
  timeoutMs: number | undefined
): Promise<SshExecResult> {
  const connection: ConnectConfig = {
    host: cfg.host,
    port: cfg.port ?? 22,
    username: cfg.username,
    readyTimeout: cfg.readyTimeoutMs ?? 15000,
    tryKeyboard: false,
  };

  if (cfg.privateKeyPath) {
    connection.privateKey = await readFile(cfg.privateKeyPath);
    if (cfg.passphrase) connection.passphrase = cfg.passphrase;
  } else if (cfg.password) {
    connection.password = cfg.password;
  }

  if (cfg.insecureAcceptUnknownHostKeys !== false) {
    connection.hostVerifier = () => true;
  }

  return new Promise<SshExecResult>((resolve, reject) => {
    const conn = new Client();
    let timer: NodeJS.Timeout | undefined;

    const clear = () => {
      if (timer) clearTimeout(timer);
    };

    if (timeoutMs && timeoutMs > 0) {
      timer = setTimeout(() => {
        try {
          conn.end();
        } catch {}
        reject(new Error(`SSH command timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    }

    conn
      .on("ready", () => {
        conn.exec(command, (err, stream) => {
          if (err) {
            clear();
            conn.end();
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
              conn.end();
              resolve({ stdout, stderr, exitCode });
            })
            .on("data", (data: Buffer) => {
              stdout += data.toString();
            });

          stream.stderr.on("data", (data: Buffer) => {
            stderr += data.toString();
          });
        });
      })
      .on("error", (err) => {
        clear();
        reject(err);
      })
      .connect(connection);
  });
}


