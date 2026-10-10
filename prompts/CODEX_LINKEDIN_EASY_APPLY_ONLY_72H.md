# LinkedIn Job Search + Easy Apply Only — Codex Change Request

## Objective

Modify the existing `Automation` job-application automation.

New workflow:
1. Search jobs on LinkedIn.
2. Change the existing job-search recency window from 24 hours to 72 hours.
3. Inspect each LinkedIn job result.
4. If it has Easy Apply, use the LinkedIn Easy Apply flow only.
5. If it does NOT have Easy Apply, do not apply; add it to a separate manual-application list for the user.
6. Never automatically apply to non-Easy-Apply jobs.

## Critical scope change

STOP automated external career-page application filling.

Do NOT develop or invoke:
- Workday automation
- Greenhouse automation
- Lever automation
- generic external career-page form filling
- external resume upload/submission
- external application submission

Those components may remain in the repository, but must not be used by this workflow.

Reuse generic infrastructure:
- Playwright
- Microsoft Edge (`channel: "msedge"`)
- existing persistent Edge profile
- LinkedIn authentication/session handling
- existing LinkedIn job search/discovery
- existing configuration/logging

Existing reusable browser infrastructure:
`scripts/lib/browser.js`

Existing Edge profile:
`output/edge-automation-profile`

## AUDIT BEFORE MODIFYING

Before coding:
1. Inspect the existing project.
2. Locate the current job-search configuration.
3. Find the setting controlling the current last-posted/recency window.
4. Identify current job result extraction.
5. Identify current Easy Apply vs external application detection.
6. Identify existing output mechanism for discovered jobs.
7. Identify code that launches external career-page application flows.

Do not guess filenames or config keys.

## Recency

Change the existing 24-hour window to **72 hours**.

Prefer changing the existing centralized config value. Do not hard-code 72 in multiple places.

## Classification

Classify each discovered job as:

### EASY_APPLY
LinkedIn clearly exposes an Easy Apply action.

### MANUAL_APPLY
No Easy Apply; LinkedIn directs the user to an external/company application.

### UNKNOWN
Cannot reliably determine application type.

For MANUAL_APPLY and UNKNOWN:
- do not apply
- do not open external application pages
- add to manual-application list
- log the reason

## Easy Apply

For EASY_APPLY:
- click the LinkedIn Easy Apply control.
- remain inside LinkedIn.
- never navigate to Workday, Greenhouse, Lever, or another external career site.
- reuse an existing LinkedIn Easy Apply flow if one already exists.
- if a complete LinkedIn Easy Apply form flow does not exist, stop at the Easy Apply entry point and report that limitation instead of falling back to external application.

Do not assume every Easy Apply form can be automatically submitted.

## Manual-application list

For non-Easy-Apply jobs, record where available:
- Job title
- Company
- Location
- LinkedIn job URL
- Posted time/age
- Reason: `NO_EASY_APPLY`
- External application URL if LinkedIn exposes one, but DO NOT open it automatically

If no application URL is available, leave it blank.

Use an existing project output mechanism if available. If none exists, use a simple JSON/CSV/Markdown file. Do not create a database.

Deduplicate using the existing job ID/URL mechanism if available.

## Search

Keep existing LinkedIn search criteria and filters unchanged except recency:
**24 hours -> 72 hours**

Do not broaden titles, locations, salary, experience, etc.

## Safety

Never bypass CAPTCHA, security checks, checkpoints, login requirements, or account restrictions.

If LinkedIn presents a security/verification state, stop safely.

Do not add stealth plugins, fingerprint spoofing, proxy rotation, CAPTCHA bypass, or anti-detection mechanisms.

## Testing

Do not immediately run a large production search.

### Test 1
Verify effective LinkedIn search recency is 72 hours.

### Test 2
Process a small number of LinkedIn jobs and demonstrate:
- Easy Apply classification
- non-Easy-Apply classification

If both are not naturally available, test what is available and report the missing state.

### Test 3
For a non-Easy-Apply job confirm:
- no external career page is opened
- no application is submitted
- job is added to manual list

### Test 4
For an Easy Apply job:
- confirm Easy Apply is detected
- confirm it stays on LinkedIn
- confirm no external career page is opened

If a complete LinkedIn Easy Apply flow already exists, test it using existing safety behavior. Otherwise stop at the Easy Apply entry point and report that form filling/submission is not implemented.

## Do not overbuild

Do not add:
- database
- CRM
- AI job scoring
- new dashboard architecture
- new browser framework
- new career-page adapters

Reuse the existing project.

## Required Codex response

Report:
1. Files inspected.
2. Existing recency configuration location/key.
3. Exact change to 72 hours.
4. Easy Apply detection logic reused or added.
5. How non-Easy-Apply jobs are classified.
6. Location/format of the manual-application list.
7. External career-page components deliberately left unused.
8. Exact test commands.
9. Test results.
10. Limitations.
11. **Next Steps for User**

Do not create multiple development phases. Keep this focused on LinkedIn job discovery + Easy Apply classification/handling.
