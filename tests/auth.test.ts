import { describe, expect, it, vi } from "vitest";

import { deviceFlow } from "../src/auth.js";
import { makeLogger } from "../src/logger.js";

const silentLog = makeLogger({ logLevel: "error" });

function makeFetchMock(
  responses: Array<{ status?: number; body: unknown }>,
): typeof fetch {
  let i = 0;
  return ((input: string | URL, _init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (i >= responses.length) {
      throw new Error(`fetchMock: ran out of responses at call ${i + 1} for ${url}`);
    }
    const r = responses[i++]!;
    return Promise.resolve(
      new Response(JSON.stringify(r.body), {
        status: r.status ?? 200,
        headers: { "content-type": "application/json" },
      }),
    );
  }) as typeof fetch;
}

const startBody = {
  device_code: "DC-abc",
  user_code: "ABCD-1234",
  verification_uri: "https://auth.prysmid.com/device",
  verification_uri_complete: "https://auth.prysmid.com/device?user_code=ABCD-1234",
  interval: 1,
  expires_in: 60,
};

describe("deviceFlow", () => {
  it("returns tokens after pending,pending,complete sequence", async () => {
    const fetchImpl = makeFetchMock([
      { body: startBody },
      { body: { status: "pending" } },
      { body: { status: "pending" } },
      {
        body: {
          status: "complete",
          access_token: "TOK-final",
          refresh_token: "REFRESH-1",
          expires_in: 3600,
        },
      },
    ]);
    const sleep = vi.fn().mockResolvedValue(undefined);
    const prompt = vi.fn();

    const tok = await deviceFlow({
      apiBase: "https://api.test.local",
      log: silentLog,
      fetchImpl,
      sleep,
      prompt,
    });

    expect(tok.accessToken).toBe("TOK-final");
    expect(tok.refreshToken).toBe("REFRESH-1");
    expect(tok.expiresIn).toBe(3600);
    expect(prompt).toHaveBeenCalledOnce();
    expect(sleep).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenNthCalledWith(1, 1000);
    expect(sleep).toHaveBeenNthCalledWith(2, 1000);
    expect(sleep).toHaveBeenNthCalledWith(3, 1000);
  });

  it("bumps interval +5s on slow_down", async () => {
    const fetchImpl = makeFetchMock([
      { body: startBody },
      { body: { status: "slow_down" } },
      {
        body: { status: "complete", access_token: "TOK", expires_in: 3600 },
      },
    ]);
    const sleep = vi.fn().mockResolvedValue(undefined);

    await deviceFlow({
      apiBase: "https://api.test.local",
      log: silentLog,
      fetchImpl,
      sleep,
      prompt: () => {},
    });

    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenNthCalledWith(1, 1000);
    expect(sleep).toHaveBeenNthCalledWith(2, 6000);
  });

  it("throws on expired", async () => {
    const fetchImpl = makeFetchMock([
      { body: startBody },
      { body: { status: "pending" } },
      { body: { status: "expired" } },
    ]);

    await expect(
      deviceFlow({
        apiBase: "https://api.test.local",
        log: silentLog,
        fetchImpl,
        sleep: vi.fn().mockResolvedValue(undefined),
        prompt: () => {},
      }),
    ).rejects.toThrow(/expired/i);
  });

  it("throws on denied", async () => {
    const fetchImpl = makeFetchMock([
      { body: startBody },
      { body: { status: "denied" } },
    ]);

    await expect(
      deviceFlow({
        apiBase: "https://api.test.local",
        log: silentLog,
        fetchImpl,
        sleep: vi.fn().mockResolvedValue(undefined),
        prompt: () => {},
      }),
    ).rejects.toThrow(/denied/i);
  });

  it("throws if start endpoint returns non-2xx", async () => {
    const fetchImpl = makeFetchMock([{ status: 503, body: { error: "down" } }]);

    await expect(
      deviceFlow({
        apiBase: "https://api.test.local",
        log: silentLog,
        fetchImpl,
        sleep: vi.fn().mockResolvedValue(undefined),
        prompt: () => {},
      }),
    ).rejects.toThrow(/503/);
  });

  it("hits the right endpoints", async () => {
    const calls: string[] = [];
    const fetchImpl: typeof fetch = ((
      input: string | URL,
      _init?: RequestInit,
    ) => {
      const url = typeof input === "string" ? input : input.toString();
      calls.push(url);
      const body =
        url.endsWith("/device/start")
          ? startBody
          : { status: "complete", access_token: "TOK", expires_in: 3600 };
      return Promise.resolve(
        new Response(JSON.stringify(body), { status: 200 }),
      );
    }) as typeof fetch;

    await deviceFlow({
      apiBase: "https://api.test.local",
      log: silentLog,
      fetchImpl,
      sleep: vi.fn().mockResolvedValue(undefined),
      prompt: () => {},
    });

    expect(calls).toEqual([
      "https://api.test.local/v1/auth/device/start",
      "https://api.test.local/v1/auth/device/poll",
    ]);
  });
});
