# Phase 2F — Taleo Portal Integration

Read `.codex/PROJECT_RULES.md` and `.codex/CODING_STANDARDS.md`.

Implement only this phase.

## Goal
Support Oracle Taleo career portals.

## Scope
- Detect Taleo.
- Capture `portalUrl`.
- Detect login state.
- Extract Company, Job Title, and Location.

Exclude login automation, form filling, and submission.

## Required File
`scripts/portals/taleo.js`

Implement `detect(page)`, `extract(page)`, and `isLoggedIn(page)`.

Return: Files created, Files modified, Testing performed, Assumptions, Next Steps for User.
