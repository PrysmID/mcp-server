# Releasing `@prysmid/mcp`

Publication runs through GitHub Actions on tag push. There is no manual `npm publish` step — every release goes through the workflow so the provenance attestation is signed by GitHub's OIDC identity.

## TL;DR

```bash
git checkout main && git pull
npm version <patch|minor|major> --no-git-tag-version
NEW=$(node -p "require('./package.json').version")
git add package.json package-lock.json
git commit -m "release: v$NEW — <one-line summary of what changed>"
git tag -a "v$NEW" -m "v$NEW"
git push origin main "v$NEW"
gh run watch -R PrysmID/mcp-server "$(gh run list -R PrysmID/mcp-server --workflow publish.yml -L 1 --json databaseId -q '.[0].databaseId')" --exit-status
npm view @prysmid/mcp version   # should equal $NEW
```

## Versioning

We follow semver against the **tool surface** the MCP exposes, not against internal refactors:

- **patch** — bug fix in an existing tool, doc/runtime polish, transitive dependency bump.
- **minor** — new tool, new optional argument, new env var, new check inside `prysmid_setup_check`.
- **major** — removed tool, renamed tool, removed required argument, breaking change in the wire format the server speaks.

Pre-1.0 we treat breaking changes as **minor** bumps (semver pre-1.0 convention). After 1.0 we'll switch to strict major-on-break.

## The workflow

`.github/workflows/publish.yml` triggers on `push` of tags matching `v*.*.*` and runs, in order:

1. `npm ci`
2. `npm run typecheck`
3. `npm test`
4. `npm run build`
5. `npm publish --access public --provenance`

`--provenance` requires `id-token: write` in the workflow permissions and publishes a sigstore attestation linking the package to the GitHub commit + workflow run that built it. Consumers can verify it with `npm audit signatures` or `npm view @prysmid/mcp --json | jq .dist.attestations`.

The publish step uses `NODE_AUTH_TOKEN` sourced from the repo secret `NPM_TOKEN`. **No 2FA / OTP is required at publish time** — the npm token is the only credential the workflow needs.

## The `NPM_TOKEN` secret

The repo secret `NPM_TOKEN` mirrors the Secrevo entry **`NPM_PRYSMID_TOKEN_ALL_PACKAGES`** (canonical name per the Prysmid Secrevo naming convention `<PLATFORM>_<WORKSPACE>_<TYPE>_<DETAIL>`). Secrevo is the source of truth; the GitHub secret is a propagation.

### Rotation procedure

Rotate the token in three cases:

- **Calendar** — 7 days before the npm token expiration date shown in npmjs.com/settings/&lt;user&gt;/tokens.
- **Suspected leak** — token value seen in any log, screenshot, chat, or workflow that did not need it.
- **Silent failure** — publish workflow returns `npm error 404 PUT https://registry.npmjs.org/@prysmid%2fmcp` with no code change. This is the documented symptom of an expired npm Granular Access Token (see "Known gotchas" below).

Steps:

1. **Generate a new token on npmjs.com**:
   - Log in with the account that owns the `prysmid` npm organization.
   - Settings → Access Tokens → Generate New Token → **Granular Access Token**.
   - Scope: `@prysmid` org, permission **Read and write**.
   - Allowed IP ranges: **leave empty** (GitHub Actions runners use dynamic IPs).
   - Expiration: maximum the plan permits (365 days recommended).
   - Name: `prysmid-mcp-publish-YYYY-MM` for tracking.

2. **Update Secrevo**:

   ```bash
   secrevo secret update NPM_PRYSMID_TOKEN_ALL_PACKAGES --from-file <token-file>
   ```

   Never paste the token into a shell argument (`--body "$TOKEN"`) — it lands in process listings. Use `--from-file` or stdin.

3. **Propagate to GitHub Actions** (no value emitted to stdout):

   ```bash
   secrevo run --secret NPM_PRYSMID_TOKEN_ALL_PACKAGES=NPM_TOKEN \
               --secret GITHUB_PERSONAL_ACCESS_TOKEN=GH_TOKEN \
     -- bash -c 'printf "%s" "$NPM_TOKEN" | gh secret set NPM_TOKEN -R PrysmID/mcp-server'
   ```

4. **Re-trigger the workflow** if a publish was blocked by the old token:

   ```bash
   gh run rerun <failed_run_id> -R PrysmID/mcp-server --failed
   ```

   `--failed` re-runs only the failed jobs; you do not need to delete and recreate the tag.

5. **Revoke the old token** in npmjs.com once the new run finishes `success`. Do not leave two valid tokens on the same scope for more than 24 hours.

## Known gotchas

### `404 Not Found - PUT /@prysmid%2fmcp` after a successful prior release

Symptom of an expired npm Granular Access Token. npm does **not** return 401 / 403 — it returns 404 as if the package did not exist. Fix is to rotate (procedure above). First observed 2026-05-20 during the v0.5.0 publish, ~30 days after the prior token was created.

### Provenance attestation appears in sigstore even when `npm publish` fails

The workflow signs and publishes the provenance attestation **before** the registry upload. If the registry rejects the upload, the attestation is already in the transparency log (search.sigstore.dev). This is harmless — the package version it points to does not exist on npm, so nothing resolves to it — but it means the sigstore index will show a "ghost" entry for the failed attempt. On the successful retry, a new attestation is published; both remain in the immutable log forever.

### `gh secret set --body-file` is not available

`gh` ≤ 2.88 only has `--body` (which puts the value in the process argv) and stdin (which does not). Use the stdin form shown in step 3 of the rotation procedure.

### `npm version` mutates `package-lock.json` too

Commit both files. The publish workflow uses `npm ci` which fails if the lockfile and `package.json` disagree.

## Quick verification after release

```bash
npm view @prysmid/mcp version                # should match the new tag
npm view @prysmid/mcp dist-tags.latest       # idem
npm view @prysmid/mcp --json | jq '.dist.attestations'   # provenance present
```

For end-to-end verification of a new tool added in the release, invoke it from a fresh agent:

```bash
npx -y @prysmid/mcp@<version> --help          # smoke
```
