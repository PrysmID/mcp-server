/**
 * OAuth 2.0 Device Authorization Grant client (RFC 8628).
 *
 * Flow:
 *   1. POST /v1/auth/device/start — get device_code + user_code + verification_uri
 *   2. Print user_code + URL to STDERR (stdout is reserved for MCP protocol)
 *   3. Poll POST /v1/auth/device/poll every `interval` seconds until:
 *        - status=complete    → return tokens
 *        - status=slow_down   → bump interval +5s, keep polling
 *        - status=expired     → throw
 *        - status=denied      → throw
 *
 * The platform side proxies these to Zitadel (auth.prysmid.com); the client
 * only ever talks to api.prysmid.com.
 */
import type { Logger } from "./logger.js";

export interface DeviceFlowToken {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
}

interface DeviceStartResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete?: string | null;
  interval: number;
  expires_in: number;
}

interface DevicePollResponse {
  status: "pending" | "slow_down" | "complete" | "expired" | "denied";
  access_token?: string | null;
  refresh_token?: string | null;
  expires_in?: number | null;
  error?: string | null;
}

export interface DeviceFlowOptions {
  apiBase: string;
  log: Logger;
  /**
   * Sleep function — overridable so tests can run instantly. Defaults to
   * setTimeout-based promise.
   */
  sleep?: (ms: number) => Promise<void>;
  /**
   * Print sink for the user-facing prompt (browser URL + code). Defaults to
   * stderr. Tests override to capture.
   */
  prompt?: (lines: string[]) => void;
  /**
   * Override the global fetch — kept for tests; production passes nothing.
   */
  fetchImpl?: typeof fetch;
}

const DEFAULT_SLEEP = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

const DEFAULT_PROMPT = (lines: string[]): void => {
  for (const line of lines) process.stderr.write(`${line}\n`);
};

export async function deviceFlow(
  opts: DeviceFlowOptions,
): Promise<DeviceFlowToken> {
  const sleep = opts.sleep ?? DEFAULT_SLEEP;
  const prompt = opts.prompt ?? DEFAULT_PROMPT;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const { apiBase, log } = opts;

  const start = await postJson<DeviceStartResponse>(
    fetchImpl,
    `${apiBase}/v1/auth/device/start`,
    {},
  );

  const verifyUrl = start.verification_uri_complete || start.verification_uri;
  prompt([
    "",
    "─────────────────────────────────────────────────────────",
    " Prysmid MCP — Sign in to your account",
    "─────────────────────────────────────────────────────────",
    "",
    "  1. Open this URL in your browser:",
    `       ${verifyUrl}`,
    "",
    "  2. Confirm the code:",
    `       ${start.user_code}`,
    "",
    `  Waiting for confirmation (expires in ${start.expires_in}s)…`,
    "",
  ]);

  let interval = Math.max(1, start.interval || 5);
  const deadline = Date.now() + start.expires_in * 1000;

  while (Date.now() < deadline) {
    await sleep(interval * 1000);

    let res: DevicePollResponse;
    try {
      res = await postJson<DevicePollResponse>(
        fetchImpl,
        `${apiBase}/v1/auth/device/poll`,
        { device_code: start.device_code },
      );
    } catch (e) {
      log.warn("device poll request failed, retrying", {
        error: e instanceof Error ? e.message : String(e),
      });
      continue;
    }

    if (res.status === "complete") {
      if (!res.access_token) {
        throw new Error(
          "Device flow returned status=complete but no access_token",
        );
      }
      log.info("device flow login complete", {
        expiresIn: res.expires_in ?? null,
      });
      return {
        accessToken: res.access_token,
        refreshToken: res.refresh_token ?? undefined,
        expiresIn: res.expires_in ?? undefined,
      };
    }
    if (res.status === "slow_down") {
      interval += 5;
      log.debug("device flow slow_down", { newInterval: interval });
      continue;
    }
    if (res.status === "pending") continue;
    if (res.status === "expired") {
      throw new Error("Device code expired before authorization");
    }
    if (res.status === "denied") {
      throw new Error("Authorization denied");
    }
    log.warn("unknown device poll status", { status: res.status });
  }

  throw new Error("Device code expired before authorization");
}

async function postJson<T>(
  fetchImpl: typeof fetch,
  url: string,
  body: unknown,
): Promise<T> {
  const res = await fetchImpl(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`POST ${url} failed: ${res.status} ${text}`);
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`POST ${url} returned non-JSON: ${text.slice(0, 200)}`);
  }
}
