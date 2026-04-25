import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  clearToken,
  getTokenPath,
  loadToken,
  saveToken,
} from "../src/tokenStore.js";

let tmp: string;
let env: NodeJS.ProcessEnv;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "prysmid-mcp-tok-"));
  env = {
    APPDATA: tmp,
    XDG_CONFIG_HOME: tmp,
  };
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

const apiBase = "https://api.test.local";
const future = () => Math.floor(Date.now() / 1000) + 3600;
const past = () => Math.floor(Date.now() / 1000) - 60;

describe("tokenStore", () => {
  it("getTokenPath honors APPDATA on win32 and XDG on unix", () => {
    const path = getTokenPath(env);
    expect(path.startsWith(tmp)).toBe(true);
    expect(path.endsWith("token.json")).toBe(true);
  });

  it("save then load round-trips a valid token", () => {
    saveToken(
      {
        apiBase,
        accessToken: "TOK",
        refreshToken: "REF",
        expiresAt: future(),
      },
      env,
    );
    const loaded = loadToken(apiBase, env);
    expect(loaded?.accessToken).toBe("TOK");
    expect(loaded?.refreshToken).toBe("REF");
  });

  it("returns null when token has no cache file", () => {
    expect(loadToken(apiBase, env)).toBeNull();
  });

  it("returns null on apiBase mismatch", () => {
    saveToken(
      { apiBase: "https://other", accessToken: "TOK", expiresAt: future() },
      env,
    );
    expect(loadToken(apiBase, env)).toBeNull();
  });

  it("returns null when token already expired", () => {
    saveToken({ apiBase, accessToken: "TOK", expiresAt: past() }, env);
    expect(loadToken(apiBase, env)).toBeNull();
  });

  it("returns null when token expires within skew window (60s)", () => {
    const inThirty = Math.floor(Date.now() / 1000) + 30;
    saveToken({ apiBase, accessToken: "TOK", expiresAt: inThirty }, env);
    expect(loadToken(apiBase, env)).toBeNull();
  });

  it("returns null on corrupted JSON", () => {
    saveToken({ apiBase, accessToken: "TOK", expiresAt: future() }, env);
    // overwrite with junk
    const path = getTokenPath(env);
    require("node:fs").writeFileSync(path, "not-json{{{", "utf8");
    expect(loadToken(apiBase, env)).toBeNull();
  });

  it("clearToken removes the file", () => {
    saveToken({ apiBase, accessToken: "TOK", expiresAt: future() }, env);
    const path = getTokenPath(env);
    expect(existsSync(path)).toBe(true);
    clearToken(env);
    expect(existsSync(path)).toBe(false);
  });

  it("clearToken is a no-op when no file exists", () => {
    expect(() => clearToken(env)).not.toThrow();
  });
});
