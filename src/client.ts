/**
 * Prysmid API client — thin fetch wrapper that adds auth + maps errors.
 *
 * Auth model (MVP): static bearer via `PRYSMID_API_TOKEN`. Device-flow OAuth
 * lives in `auth.ts` and produces a token compatible with this client.
 */
import type { Config } from "./config.js";
import type { Logger } from "./logger.js";

export class PrysmidApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: string,
    public readonly code?: string,
  ) {
    super(message);
    this.name = "PrysmidApiError";
  }
}

export interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
}

export class PrysmidClient {
  constructor(
    private readonly cfg: Config,
    private readonly log: Logger,
  ) {}

  async request<T = unknown>(path: string, opts: RequestOptions = {}): Promise<T> {
    if (!this.cfg.apiToken) {
      throw new PrysmidApiError(
        "No PRYSMID_API_TOKEN configured. Set the env var or run device-flow login.",
        401,
        "",
        "auth.no_token",
      );
    }

    const url = new URL(this.cfg.apiBase + path);
    if (opts.query) {
      for (const [k, v] of Object.entries(opts.query)) {
        if (v !== undefined) url.searchParams.set(k, String(v));
      }
    }

    const method = opts.method ?? "GET";
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.cfg.apiToken}`,
      Accept: "application/json",
    };
    if (opts.body !== undefined) headers["Content-Type"] = "application/json";

    this.log.debug(`HTTP ${method} ${url.pathname}`);
    const res = await fetch(url, {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });

    const text = await res.text();
    if (!res.ok) {
      let code: string | undefined;
      try {
        const parsed = JSON.parse(text);
        code = typeof parsed?.error === "string" ? parsed.error : parsed?.code;
      } catch {
        // body wasn't JSON
      }
      throw new PrysmidApiError(
        `Prysmid API ${res.status} on ${method} ${path}`,
        res.status,
        text,
        code,
      );
    }

    if (text === "") return undefined as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      return text as unknown as T;
    }
  }
}
