# Phase 2 — Portal Detection

Read project rules first.

Implement only this phase.

---

## Goal

Detect which career portal each application uses.

Supported:

* LinkedIn
* Workday
* Greenhouse
* Lever

Leave ICIMS, Taleo, SmartRecruiters, and Custom for later.

---

## New Files

Create:

* scripts/portals/detector.js
* scripts/portals/workday.js
* scripts/portals/greenhouse.js
* scripts/portals/lever.js

---

## Output

Update apply_candidates.json.

Example:

```json
{
  "portal":"workday",
  "loginRequired":true
}
```

Do not automate login yet.

---

## Success Criteria

Every Apply job identifies its portal correctly.
