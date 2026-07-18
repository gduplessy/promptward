# Plan 008: Correct the README's placeholder-rehydration claim

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `grep -rn "revealText\|reveal(" src/ | grep -v "shared/messages\|shared/offscreen-routing\|offscreen.ts\|rampart-worker.ts`
> If this grep finds a NEW caller of reveal (e.g. a content-script response
> observer), the feature has been wired since planning — STOP; this plan is
> obsolete and should be marked REJECTED in `plans/README.md`.

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW (documentation only)
- **Depends on**: none
- **Category**: docs
- **Planned at**: commit `a6293e1`, 2026-07-17

## Why this matters

The README advertises: *"Reversible placeholders. Redacted tokens like
`[PERSON_1]` or `[SSN_1]` rehydrate back to their real values within the same
conversation, so model responses referencing them still read naturally."*
This does not happen. The plumbing exists end-to-end — a `PW_REVEAL_TEXT`
message type, an offscreen route, and `guard.reveal()` in the worker — but
**nothing ever sends that message**: no content-script code observes model
responses or calls reveal. A user who reads the feature list expects
assistant replies to show real values; they will see raw `[PERSON_1]` tokens
and conclude the extension is broken. Actively wrong docs are worse than
missing ones. The honest fix today is to describe what ships; actually wiring
response rehydration is a separate, larger piece of work (recorded as a
direction option in `plans/README.md`).

## Current state

- `README.md:32` (Features bullet):

  ```markdown
  - **Reversible placeholders.** Redacted tokens like `[PERSON_1]` or `[SSN_1]` rehydrate back to their real values within the same conversation, so model responses referencing them still read naturally.
  ```

- `README.md:65` (Known limitations bullet):

  ```markdown
  - Reversible placeholders are scoped to a single conversation/tab; they reset on navigation, tab close, or extension reload.
  ```

- Code reality: `revealText` appears only in `src/shared/messages.ts`
  (type + validator), `src/shared/offscreen-routing.ts` (route set),
  `src/offscreen.ts:86` (dispatch to worker), `src/rampart-worker.ts:134-137`
  (`guard.reveal`). Zero senders. The per-conversation placeholder maps DO
  exist and are kept in worker memory (`guards` map keyed by conversation),
  and ARE reset on navigation/tab close (`src/background.ts:28-42`), so the
  limitations bullet is about a real mechanism — it just isn't user-visible
  yet.
- `PRIVACY.md` mentions "Placeholder maps stay in extension memory..." —
  accurate, no change needed.
- Do NOT delete the reveal plumbing — the direction option in
  `plans/README.md` proposes wiring it; the dead code is small and typed.

## Commands you will need

| Purpose   | Command    | Expected on success |
|-----------|------------|---------------------|
| Tests     | `npm test` | all pass (proves no accidental code change) |

## Scope

**In scope**:
- `README.md` (two bullets)

**Out of scope**:
- All of `src/` — no code changes, including no deletion of reveal plumbing.
- `PRIVACY.md`, `NOTICE`.

## Git workflow

- Branch: `advisor/008-readme-rehydration`
- Commit style: `docs(readme): describe placeholder rehydration as planned, not shipped`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Rewrite the Features bullet

Replace the `README.md:32` bullet with:

```markdown
- **Reversible placeholders (foundation).** Redaction keeps a per-conversation map from tokens like `[PERSON_1]` or `[SSN_1]` back to their real values, held only in extension memory. Automatic rehydration of model responses is not wired up yet — replies will show the placeholder tokens as-is.
```

### Step 2: Rewrite the Known limitations bullet

Replace the `README.md:65` bullet with:

```markdown
- Model responses are not yet rehydrated: replies that reference redacted values show the placeholder tokens (e.g. `[PERSON_1]`) rather than the original text. The placeholder maps that would enable this are kept per conversation/tab and reset on navigation, tab close, or extension reload.
```

**Verify**: `grep -n "rehydrate" README.md` → both occurrences now describe
the feature as not-yet-wired.

### Step 3: Confirm nothing else changed

**Verify**: `git diff --name-only` → exactly `README.md` (plus
`plans/README.md` once you update the status row).
**Verify**: `npm test` → all pass.

## Test plan

None — docs-only.

## Done criteria

- [ ] Both bullets updated; no README sentence still claims responses "read naturally" via rehydration
- [ ] `git diff --name-only` shows only `README.md` and `plans/README.md`
- [ ] `npm test` exits 0
- [ ] `plans/README.md` status row updated

## STOP conditions

- The drift-check grep found a real reveal caller — mark this plan REJECTED
  (feature landed) and report.
- The README bullets don't match the excerpts (README was edited since
  planning) — reconcile the intent (describe reality) rather than pasting
  blindly, and note the deviation when reporting.

## Maintenance notes

- If the "wire response rehydration" direction option is ever executed, these
  two bullets revert to present-tense feature copy — the executor of that
  work should treat this plan's wording as the marker to remove.
