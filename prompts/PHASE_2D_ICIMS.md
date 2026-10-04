# Phase 2D — ICIMS Portal Integration

Read `.codex/PROJECT_RULES.md` and `.codex/CODING_STANDARDS.md`.

Implement only this phase.

## Goal
Support ICIMS career portals.

## Scope
- Detect ICIMS.
- Capture `portalUrl`.
- Detect login state.
- Extract Company, Job Title, and Location.

Exclude login automation, form filling, and submission.

## Required File
`scripts/portals/icims.js`

Implement `detect(page)`, `extract(page)`, and `isLoggedIn(page)`.

Return: Files created, Files modified, Testing performed, Assumptions, Next Steps for User.
