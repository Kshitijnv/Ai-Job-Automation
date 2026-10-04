# Phase 1 — Browser Automation Foundation

Read `.codex/PROJECT_RULES.md` and `.codex/CODING_STANDARDS.md` first.

Implement only this phase.

---

## Goal

Automatically open Apply jobs inside a logged-in browser using Playwright.

No form filling.

No login automation.

---

## Existing Inputs

Use:

* output/today_jobs_ranked.json
* config/profile.json

---

## New Files

Create:

* scripts/apply-agent.js
* config/browser.json
* scripts/lib/browser.js

---

## Browser Requirements

Use Microsoft Edge.

Reuse the user's existing Edge profile.

Never automate LinkedIn login.

The user is already logged in.

---

## Behavior

Process only jobs where:

`action = "Apply" or "Review"` 

For each job:

1. Open LinkedIn URL.
2. Detect:

   * Easy Apply
   * External Apply
   * Already Applied
3. Record the result.

Do not submit anything.

---

## browser.json

Create:

```json
{
  "browser":"edge",
  "profilePath":"C:\\Users\\<User>\\AppData\\Local\\Microsoft\\Edge\\User Data"
}
```

---

## Output

Create:

`output/apply_candidates.json`

Example:

```json
{
  "company":"FIS",
  "portal":"linkedin",
  "button":"Easy Apply"
}
```

---

## Constraints

* No auto submission.
* No credential storage.
* No portal automation yet.
* Preserve existing pipeline.

---

## Success Criteria

* Edge opens using existing profile.
* LinkedIn remains logged in.
* Apply jobs open automatically.
* Easy Apply detection works.
* External Apply detection works.
* Already Applied detection works.
