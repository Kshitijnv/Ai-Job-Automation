# Phase 2G — Generic Portal Fallback

Read `.codex/PROJECT_RULES.md` and `.codex/CODING_STANDARDS.md`.

Implement only this phase.

## Goal
Provide a fallback handler for unknown company career portals.

## Scope
- Detect unknown portals.
- Capture `portalUrl`.
- Extract basic metadata.
- Continue processing without failing.

Exclude login automation, form filling, and submission.

## Required File
`scripts/portals/generic.js`

Implement `detect(page)`, `extract(page)`, and `isLoggedIn(page)`.

Return: Files created, Files modified, Testing performed, Assumptions, Next Steps for User.
