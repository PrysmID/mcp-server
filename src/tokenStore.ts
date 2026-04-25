/**
 * On-disk cache for the device-flow access token.
 *
 * Path layout:
 *   - Windows: %APPDATA%\prysmid-mcp\token.json
 *   - Linux/macOS: $XDG_CONFIG_HOME/prysmid-mcp/token.json (default ~/.config/prysmid-mcp)
 *   - Fallback: ~/.prysmid-mcp/token.json
 *
 * The cache is keyed by `apiBase` so switching between staging/prod is safe.
 * Token file is mode 0600 on Unix; Windows ignores the chmod.
 */
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir, platform } from "node:os";
import { dirname, join } from "node:path";

export interface CachedToken {
  apiBase: string;
  accessToken: string;
  refreshToken?: string;
  /** Unix epoch seconds. */
  expiresAt: number;
}

const APP_DIR = "prysmid-mcp";
const FILE_NAME = "token.json";
const EXPIRY_SKEW_SECONDS = 60;

export function getTokenPath(env: NodeJS.ProcessEnv = process.env): string {
  if (platform() === "win32") {
    const base = env.APPDATA;
    if (base) return join(base, APP_DIR, FILE_NAME);
    return join(homedir(), `.${APP_DIR}`, FILE_NAME);
  }
  const xdg = env.XDG_CONFIG_HOME;
  if (xdg) return join(xdg, APP_DIR, FILE_NAME);
  return join(homedir(), ".config", APP_DIR, FILE_NAME);
}

export function loadToken(
  apiBase: string,
  env: NodeJS.ProcessEnv = process.env,
): CachedToken | null {
  const path = getTokenPath(env);
  if (!existsSync(path)) return null;
  let parsed: CachedToken;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8")) as CachedToken;
  } catch {
    return null;
  }
  if (parsed.apiBase !== apiBase) return null;
  const nowSec = Math.floor(Date.now() / 1000);
  if (parsed.expiresAt - EXPIRY_SKEW_SECONDS <= nowSec) return null;
  if (typeof parsed.accessToken !== "string" || !parsed.accessToken) {
    return null;
  }
  return parsed;
}

export function saveToken(
  token: CachedToken,
  env: NodeJS.ProcessEnv = process.env,
): void {
  const path = getTokenPath(env);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(token, null, 2), "utf8");
  if (platform() !== "win32") {
    try {
      chmodSync(path, 0o600);
    } catch {
      // best-effort
    }
  }
}

export function clearToken(env: NodeJS.ProcessEnv = process.env): void {
  const path = getTokenPath(env);
  if (existsSync(path)) {
    rmSync(path, { force: true });
  }
}
