# Phase 2A — Portal Detection (Workday First)

Read these files first:

* `.codex/PROJECT_RULES.md`
* `.codex/CODING_STANDARDS.md`

Implement **only this phase**.

---

## Goal

Detect **Workday** career portals from LinkedIn External Apply jobs and capture the real portal URL.

This phase does **not** automate login, form filling, or application submission.

The objective is to build a reusable portal architecture.

---

## Current Status

Already completed:

* Search Agent
* Fit Agent
* JD Agent
* Resume Agent
* Dashboard Agent
* Apply Agent (Playwright)
* LinkedIn login detection
* Standardized `apply_candidates.json`

Build on the existing implementation.

---

## Scope

### Included

* Detect Workday.
* Save `portalUrl`.
* Open Workday directly on future runs.
* Detect whether Workday is:

  * Login page
  * Job page
  * Unknown
* Extract basic job information.

### Not Included

* Auto login
* Credential management
* Form filling
* Application submission
* Greenhouse
* Lever
* ICIMS
* Taleo
* SmartRecruiters

Those belong to later phases.

---

## Required Files

Create:

```text
scripts/
└── portals/
    ├── base.js
    ├── detector.js
    └── workday.js
```

---

## Portal Architecture

Every portal module must expose the same interface.

```javascript
detect(page)
extract(page)
isLoggedIn(page)
```

### Responsibilities

| Method     | Purpose                                      |
| ---------- | -------------------------------------------- |
| detect     | Identify whether this portal owns the page   |
| extract    | Extract job metadata                         |
| isLoggedIn | Determine whether authentication is required |

Future portals must follow this same contract.

---

## Workday Detection

When LinkedIn redirects to Workday:

1. Detect that the destination is Workday.
2. Capture the final redirected URL.
3. Save it as `portalUrl`.

Example:

```json
{
  "portal": "workday",
  "portalUrl": "https://company.wd5.myworkdayjobs.com/...",
  "status": "ExternalApply",
  "nextAction": "OpenExternal"
}
```

Future reruns should reuse `portalUrl` instead of navigating through LinkedIn again.

---

## Job Metadata Extraction

If available, extract:

* Company
* Job Title
* Location

Do not fail if some fields are missing.

---

## apply_candidates.json

Enrich existing entries.

Do **not** remove existing fields.

Add:

* `portal`
* `portalUrl`
* `status`
* `nextAction`

Preserve the existing schema introduced in Phase 1.1.

---

## Error Handling

Handle these cases gracefully.

| Situation          | Expected Behavior        |
| ------------------ | ------------------------ |
| Workday login page | Detect as login required |
| Unknown portal     | Leave as Generic         |
| Redirect failure   | Mark Retry               |
| Missing metadata   | Keep processing          |

Never crash the whole run because one job fails.

---

## Constraints

* Preserve the existing pipeline.
* Keep changes modular.
* Do not modify unrelated agents.
* Do not submit applications.
* No credential storage.
* No auto-login.

---

## Success Criteria

* Workday is detected correctly.
* `portalUrl` is captured.
* Future runs reuse `portalUrl`.
* Login state is detected.
* Basic metadata is extracted.
* Existing pipeline continues working.

---

## Required Response Format

At completion provide:

1. Files created
2. Files modified
3. Testing performed
4. Assumptions
5. **Next Steps for User** (mandatory)

The Next Steps section must include:

* Commands to run
* Files to edit (if any)
* Manual verification steps
* Expected results
