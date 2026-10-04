# Phase 2B — Greenhouse Portal Integration

Read `.codex/PROJECT_RULES.md` and `.codex/CODING_STANDARDS.md`.

Implement only this phase.

## Goal
Add Greenhouse support using the existing portal architecture.

## Scope
- Detect Greenhouse pages.
- Capture `portalUrl`.
- Detect login state.
- Extract Company, Job Title, and Location.
- Reuse `portalUrl`.

Exclude login automation, credential management, form filling, and submission.

## Required File
`scripts/portals/greenhouse.js`

Implement `detect(page)`, `extract(page)`, and `isLoggedIn(page)`.

Enrich `apply_candidates.json` without removing existing fields.

Return: Files created, Files modified, Testing performed, Assumptions, Next Steps for User.
