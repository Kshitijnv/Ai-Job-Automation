# Phase 2C — Lever Portal Integration

Read `.codex/PROJECT_RULES.md` and `.codex/CODING_STANDARDS.md`.

Implement only this phase.

## Goal
Add Lever support using the shared portal architecture.

## Scope
- Detect Lever pages.
- Capture `portalUrl`.
- Detect login state.
- Extract Company, Job Title, and Location.
- Reuse `portalUrl`.

Exclude login automation, credential storage, form filling, and submission.

## Required File
`scripts/portals/lever.js`

Implement `detect(page)`, `extract(page)`, and `isLoggedIn(page)`.

Return: Files created, Files modified, Testing performed, Assumptions, Next Steps for User.
