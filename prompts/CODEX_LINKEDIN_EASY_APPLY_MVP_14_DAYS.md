# LinkedIn Job Automation MVP — 14-Day Search + Easy Apply

## Objective

Continue modifying the existing `Automation` job-application automation.

We are now focusing ONLY on:

1. LinkedIn job discovery
2. Searching jobs posted within the last **14 days**
3. Detecting whether a job supports **Easy Apply**
4. Automatically entering/submitting the LinkedIn Easy Apply flow
5. Separately recording jobs that do NOT have Easy Apply for manual application

We want a FAST MVP.

**Do NOT create multiple development phases.**
Implement this as one focused MVP change using the existing project.

---

# Important correction to the previous requirement

The existing job-search window was originally **7 days**, not 24 hours.

The previous instruction incorrectly changed it from 7 days to 3 days.

The actual requirement is now:

**7 days → 14 days**

The goal is to discover MORE jobs, not reduce the search window.

Find the existing centralized recency configuration and change the effective window to:

`14 days`

Do not create a second recency configuration.

---

# New workflow

The final intended workflow is:

LinkedIn Job Search
        ↓
Jobs posted within last 14 days
        ↓
Inspect job
        ↓
Does LinkedIn show Easy Apply?
        │
        ├── YES
        │     ↓
        │  Click Easy Apply
        │     ↓
        │  Fill LinkedIn Easy Apply form
        │     ↓
        │  Review/submit according to existing safe workflow
        │
        └── NO
              ↓
        DO NOT APPLY
              ↓
        Add job to separate Manual Apply list

---

# CRITICAL: External career pages remain disabled

The old career-page application automation is STOPPED.

Never automatically apply through:

- Workday
- Greenhouse
- Lever
- company career portals
- external application forms
- external ATS systems

If a LinkedIn job does not have Easy Apply:

**Do absolutely nothing on the external application site.**

Record the job for the user instead.

Existing career-page modules may remain in the repository, but this workflow must not invoke them.

---

# Easy Apply MVP

The Easy Apply flow should work similarly to the Connect automation we just implemented:

1. Locate the actual LinkedIn Easy Apply control from the DOM.
2. Prefer robust semantic/attribute-based selectors.
3. Do not depend on fragile LinkedIn CSS classes.
4. If normal Playwright click is blocked by an overlay, inspect the actual element and use a safe fallback based on the real LinkedIn href/action exposed by the element, similar to the Connect implementation.
5. Stay within LinkedIn.
6. Detect the Easy Apply modal/dialog.
7. Process the form.
8. Handle multiple steps/pages.
9. Complete required fields using the user's existing application data/configuration.
10. Upload the existing resume only when the LinkedIn Easy Apply form requests it and the existing project already has the resume available.
11. Submit only when the form is complete and the application is an actual LinkedIn Easy Apply flow.

Do not navigate to an external career site.

---

# Reuse existing project functionality

Before implementing anything, inspect the current project.

Reuse existing:

- Playwright infrastructure
- Microsoft Edge (`channel: "msedge"`)
- persistent Edge profile
- LinkedIn login/session
- job search
- job extraction
- job deduplication
- resume handling if already present
- candidate/application data if already present
- logging
- existing configuration

Do NOT rebuild infrastructure that already exists.

Existing generic browser infrastructure:

`scripts/lib/browser.js`

Existing Edge profile:

`output/edge-automation-profile`

---

# First: inspect the existing project

Before modifying code, identify:

1. Current job-search configuration.
2. Current recency configuration.
3. Current LinkedIn job-result extraction.
4. Current Easy Apply detection, if any.
5. Current job application workflow.
6. Existing resume path/configuration.
7. Existing user/application profile data.
8. Existing form-filling utilities.
9. Existing output/dashboard/list for discovered jobs.
10. Existing external career-page modules.

Do not guess filenames.

Reuse what already works.

---

# Recency requirement

The correct current baseline is:

`7 days`

Change it to:

`14 days`

Verify that the actual LinkedIn search request/filter uses 14 days.

Do not simply change a comment or unused config value.

---

# Easy Apply detection

For each job classify:

### EASY_APPLY

LinkedIn clearly exposes an Easy Apply action.

### MANUAL_APPLY

LinkedIn does not expose Easy Apply and instead provides an external/company application.

### UNKNOWN

The automation cannot reliably determine the application method.

For MANUAL_APPLY and UNKNOWN:

- do not click external Apply
- do not open external application pages
- do not fill external forms
- add the job to the manual list
- continue to the next LinkedIn job

---

# Manual Apply list

Maintain a simple separate list containing, where available:

- Job title
- Company
- Location
- LinkedIn job URL
- Posted age/date
- Reason: `NO_EASY_APPLY` or `UNKNOWN_APPLICATION_TYPE`
- External application URL if LinkedIn exposes it

Do not create a database unless the existing project already uses one.

Prefer the existing output mechanism.

Deduplicate jobs using the existing LinkedIn job ID/URL mechanism.

---

# Easy Apply form handling

For MVP, automate the normal LinkedIn Easy Apply workflow.

The form can contain:

- text inputs
- number inputs
- dropdowns
- radio buttons
- checkboxes
- yes/no questions
- phone number
- location
- work authorization questions
- experience questions
- resume upload
- review page

Use the user's existing application profile/configuration wherever available.

Do not invent answers.

If an application question requires information that is not present in the existing user/application data:

- stop safely for that application
- mark the job as `NEEDS_USER_INPUT`
- record the question
- do not submit an incomplete or guessed application

---

# Important: do not guess application answers

Never invent:

- years of experience
- salary
- notice period
- visa/work authorization
- sponsorship
- relocation preference
- demographic information
- education details
- certification status
- skills the user does not have

Use existing configured user data only.

If the answer is unavailable, stop that application and record the missing field.

---

# Submit behavior

For a complete Easy Apply application:

1. Fill the required fields.
2. Navigate through the normal LinkedIn steps.
3. Reach the Review/Submit stage.
4. Verify that all required fields are complete.
5. Submit using LinkedIn's normal Submit Application control.
6. Detect a successful application confirmation/state.
7. Record the application as:

`APPLIED`

Do not repeatedly submit the same application.

If submission state cannot be verified:

`UNVERIFIED`

Do not retry automatically.

---

# Safety

Never bypass:

- CAPTCHA
- LinkedIn security verification
- checkpoints
- login requirements
- account restrictions
- unusual security challenges

If one appears:

STOP the current application safely.

Do not add:

- stealth plugins
- fingerprint spoofing
- proxy rotation
- CAPTCHA bypass
- anti-detection techniques

Normal UI waits are fine.

---

# Do not overbuild

This is an MVP.

Do NOT add:

- n8n
- database
- CRM
- AI job scoring
- new dashboard architecture
- new browser framework
- new ATS adapters
- Workday support
- Greenhouse support
- Lever support
- external career-page automation

Use the existing project.

---

# Testing

Do NOT immediately process a large production batch.

Run a small controlled test.

## Test 1 — Recency

Confirm the effective search window is:

**14 days**

Show the configuration key/value or actual search parameter used.

## Test 2 — Easy Apply detection

Find a LinkedIn job with Easy Apply and confirm:

- Easy Apply detected
- correct LinkedIn control located
- Easy Apply opened
- no external career page opened

## Test 3 — Easy Apply form

Process one real Easy Apply job.

Confirm:

- modal opened
- fields detected
- known fields filled
- missing/unknown fields handled safely
- multiple steps handled if present
- review stage reached

## Test 4 — Submission

If the test application can safely be submitted using the configured user data:

- submit it
- verify LinkedIn confirmation
- record `APPLIED`

If required information is missing:

- do not guess
- record `NEEDS_USER_INPUT`
- stop that application safely

## Test 5 — Non-Easy-Apply

Process one non-Easy-Apply job if available.

Confirm:

- no external career page opened
- no external application submitted
- job added to manual list

If both Easy Apply and non-Easy-Apply jobs are not naturally available in the test results, report which state could not be tested rather than fabricating one.

---

# Production behavior after MVP validation

Once the controlled test succeeds, the existing search can operate over the full configured 14-day window.

For each job:

- Easy Apply → automate LinkedIn application
- No Easy Apply → manual list only
- Unknown → manual list only

Never send a non-Easy-Apply job to the old career-page automation.

---

# Required Codex response

After implementation report:

1. Files inspected.
2. Current recency configuration location/key.
3. Exact change: 7 days → 14 days.
4. Easy Apply detection strategy.
5. Easy Apply click strategy and any href fallback used.
6. Existing form-filling functionality reused.
7. Where user/application data comes from.
8. How missing answers are handled.
9. How successful submissions are detected.
10. Where the manual-application list is stored.
11. Which external career-page components were deliberately disabled/unused.
12. Exact test commands.
13. Test results.
14. Any limitations.
15. **Next Steps for User**

Do not create multiple phases.

This is one focused MVP implementation.
