# Plan 009: Validate custom-domain input before requesting permissions or registering scripts

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat a6293e1..HEAD -- src/shared/settings.ts src/sidepanel.ts src/background.ts tests/settings.test.ts`
> Any drift in the excerpts below is a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `a6293e1`, 2026-07-17

## Why this matters

The side panel's "Custom domains" form accepts any string. Input like
`example.com/chat`, `https://example.com`, `foo bar`, or an empty-after-trim
value flows into `chrome.permissions.request({ origins: ["*://<input>/*"] })`
and later `chrome.scripting.registerContentScripts({ matches: [...] })`. An
invalid match pattern makes those APIs **throw**; the rejections are
unhandled (`void`-ed async listeners), the UI shows nothing, and — worse — a
bad entry persisted to `chrome.storage.sync` makes `registerCustomDomainScripts`
throw on every subsequent startup, silently breaking content-script
registration for ALL custom domains (the whole registration is one call with
one `matches` array). One malformed entry disables protection on every
custom site.

## Current state

- `src/shared/settings.ts:19-21`:

  ```ts
  export function normalizeHost(host: string): string {
    return host.trim().toLowerCase().replace(/^\*\./, "");
  }
  ```

  No validation exists anywhere (`grep -n "isValidHost\|validateHost" src/` → nothing).
- `src/sidepanel.ts:139-151` — the submit handler: normalize → (no check
  beyond falsy) → `chrome.permissions.request({ origins: ["*://${host}/*"] })`
  → persist to `customDomains`.
- `src/background.ts:200-220` — `registerCustomDomainScripts()`: maps every
  stored domain into a match pattern and registers them all in ONE
  `registerContentScripts` call; one invalid pattern rejects the whole call
  (the `.catch(() => undefined)` on line 202 covers only the *unregister*).
- Chrome match-pattern host rules: letters, digits, hyphens, dots; no
  scheme, path, port, userinfo, or spaces. A leading `*.` wildcard label is
  handled by `normalizeHost` (stripped) before pattern construction.
- Status feedback convention in the side panel: `render("Some message")`
  re-renders with the message in the header status span — e.g.
  `await render("Permission denied")` on line 147. Match it.
- Tests: `tests/settings.test.ts` — plain unit tests over `settings.ts`
  exports; model new tests on it.

## Commands you will need

| Purpose   | Command                              | Expected on success |
|-----------|--------------------------------------|---------------------|
| Typecheck | `npx tsc -p tsconfig.json --noEmit`  | exit 0              |
| Tests     | `npm test`                           | all pass            |
| One file  | `npx vitest run tests/settings.test.ts` | all pass         |

## Scope

**In scope**:
- `src/shared/settings.ts` (add `isValidCustomHost`)
- `src/sidepanel.ts` (reject invalid input with status feedback)
- `src/background.ts` (filter invalid stored entries defensively; log instead
  of crash)
- `tests/settings.test.ts` (new cases)

**Out of scope**:
- IDN/punycode conversion — out of scope; document in maintenance notes.
  (Chrome match patterns want punycode; a unicode hostname will simply fail
  validation, which is safe.)
- The built-in domains list, `isSiteEnabled` semantics, permission removal
  flow.

## Git workflow

- Branch: `advisor/009-domain-validation`
- Commit style: `fix(settings): validate custom domains before permission and registration`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Add the validator

In `src/shared/settings.ts`, below `normalizeHost`:

```ts
const HOST_PATTERN = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]?$/;

/** Accepts a bare registrable hostname (post-normalizeHost): no scheme, path,
 *  port, spaces, or IP-literal brackets. Rejects single-label hosts ("localhost"). */
export function isValidCustomHost(host: string): boolean {
  return host.length > 0 && host.length <= 253 && HOST_PATTERN.test(host);
}
```

**Verify**: `npx tsc -p tsconfig.json --noEmit` → exit 0.

### Step 2: Enforce in the side panel

In `src/sidepanel.ts`, in the `#custom-form` submit handler, after
`normalizeHost`:

```ts
const host = normalizeHost(input?.value ?? "");
if (!isValidCustomHost(host)) {
  await render("Invalid domain — use a bare hostname like example.com");
  return;
}
```

(Import `isValidCustomHost` alongside the existing `normalizeHost` import.)

**Verify**: `npx tsc -p tsconfig.json --noEmit` → exit 0.

### Step 3: Make background registration defensive

In `src/background.ts`, `registerCustomDomainScripts`:

1. Filter: `const hosts = settings.customDomains.map(normalizeHost).filter(isValidCustomHost);`
   and build `matches` from `hosts`; return early when empty (preserving the
   existing unregister-first behavior).
2. Wrap the `registerContentScripts` call so a rejection is logged, not
   unhandled: `.catch((error: unknown) => { console.warn("[PromptWard] custom domain registration failed", error); })`
   — matching the repo's existing `console.debug("[PromptWard]", ...)` tag style.

This guarantees a legacy bad entry already in `chrome.storage.sync` (written
before this fix) can no longer break registration for valid ones... note the
filter accomplishes that; the catch is belt-and-braces.

**Verify**: `npx tsc -p tsconfig.json --noEmit` → exit 0.

### Step 4: Tests

In `tests/settings.test.ts`, add a `describe("isValidCustomHost")` block:

Accept: `"example.com"`, `"ai.example.co.uk"`, `"my-app.example.io"`,
`"chat.example123.com"`.
Reject: `""`, `"localhost"` (single label), `"example.com/chat"`,
`"https://example.com"`, `"foo bar.com"`, `"example..com"`, `"-bad.example.com"`,
`"example.com:8080"`, a 260-char host, `"例え.jp"` (unicode — see scope note).

Also one integration-shaped case: `normalizeHost("*.Example.COM ")` feeding
`isValidCustomHost` → `true` (the wildcard-strip + validate pipeline used by
the side panel).

**Verify**: `npx vitest run tests/settings.test.ts` → all pass, ~12 new assertions.

### Step 5: Full suite

**Verify**: `npm test` → exit 0.

## Test plan

Step 4; pattern `tests/settings.test.ts`. Side-panel and background wiring
are thin call sites verified by typecheck (no existing harness imports
`sidepanel.ts`/`background.ts`; do not build one for this plan).

## Done criteria

- [ ] `npx tsc -p tsconfig.json --noEmit` exits 0
- [ ] `npm test` exits 0 with the new validator tests passing
- [ ] `grep -n "isValidCustomHost" src/shared/settings.ts src/sidepanel.ts src/background.ts` → present in all three
- [ ] `git status` shows only in-scope files + `plans/README.md`
- [ ] `plans/README.md` status row updated

## STOP conditions

- Excerpted code drifted (e.g. the side-panel form handler was restructured).
- You find the sidepanel already validating (duplicate work — reconcile).
- The regex rejects a hostname you believe is legitimately common — do not
  loosen it beyond the spec above on your own judgment; report the case.

## Maintenance notes

- Deliberately deferred: punycode conversion for unicode hostnames (users can
  enter the `xn--` form today), and per-entry registration IDs so one bad
  future pattern can't affect others (the filter makes this moot for now).
- Reviewer focus: the background filter must run on *stored* values (legacy
  bad entries), not just trust that the side panel now validates.
