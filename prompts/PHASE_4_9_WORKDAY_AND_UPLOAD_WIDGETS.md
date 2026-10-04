# Phase 4.9 — Workday Application Entry + Upload Widget Handling

Read these files first:

- `.codex/PROJECT_RULES.md`
- `.codex/CODING_STANDARDS.md`
- `prompts/PHASE_4_FORM_FILLING.md`
- `prompts/PHASE_4_6_PORTAL_ENTRY.md`
- `prompts/PHASE_4_7_NAVIGATION_ENGINE.md`
- `prompts/PHASE_4_8_APPLICATION_QUESTION_INTELLIGENCE.md`

Implement only this phase.

## Goal

Fix the two remaining MVP blockers visible after Phase 4.8:

1. Workday application entry stops at the `Start Your Application` modal instead of reaching the actual application form.
2. Greenhouse resume upload is detected semantically but is not uploaded because the upload control is a custom widget and the native file input is not initially exposed.

Also clean up duplicate controls for fields such as Location and Phone without changing the existing semantic-question behavior.

Do not implement Phase 5 or application submission.

---

## 1. Workday Start Your Application Modal

The current SimCorp Workday page shows:

- `Apply`
- Clicking Apply opens a modal titled `Start Your Application`
- Modal options:
  - `Autofill with Resume`
  - `Apply Manually`
  - `Use My Last Application`
  - `Apply With LinkedIn`

The screenshot confirms this modal is the actual next navigation step.

### Required behavior

After clicking the Workday job-page `Apply` button:

1. Wait for the `Start Your Application` modal.
2. Detect the modal using semantic text/role rather than coordinates.
3. Prefer `Apply Manually` for this automation.
4. Do NOT use `Autofill with Resume` because the automation must control the tailored resume upload and field values.
5. Do NOT use `Use My Last Application`.
6. Do NOT use `Apply With LinkedIn`.
7. Click `Apply Manually`.
8. Wait for the actual Workday application form to become ready.
9. Re-run form detection after the transition.
10. Continue with the existing semantic mapper, saved answers, credential handling, resume upload, and review queue.

Support reasonable Workday wording variants such as:

- Start Your Application
- Apply Manually
- Manual Application
- Continue Application

Do not use screen coordinates.

### Readiness

The modal and form may appear asynchronously.

Use condition-based waits:
- visible modal
- visible target button
- form controls
- portal-specific application indicators

Do not rely only on fixed sleeps.

---

## 2. Workday Form Readiness After Modal

The current result:

```text
workday: SimCorp — 0 fields filled; 0 human-required.
```

is not acceptable when the modal is visible.

Improve the flow so that:

```text
job page
→ Apply
→ Start Your Application modal
→ Apply Manually
→ application form
→ form detection
→ field mapping/filling
```

is treated as one portal transition.

If Workday opens a new tab/page/frame during the transition, follow the resulting application context.

If the form still cannot be reached, record a precise reason such as:

`Workday application modal detected but Apply Manually transition did not produce an application form`

Do not report the generic `Application form controls were not detected` when the real blocker is the modal transition.

---

## 3. Greenhouse Resume Upload Widget

Current Payoneer output says:

```json
"canonicalId": "resume_upload"
```

but:

```json
"resumeUpload": {
  "uploaded": false,
  "reason": "No resume file input was found."
}
```

The page visibly contains:

- Resume/CV
- Attach
- Dropbox
- Enter manually
- accepted file types

The native file input may be hidden or created only after clicking `Attach`.

### Required behavior

For `resume_upload`:

1. Detect the resume upload widget.
2. Find the relevant `Attach` control associated with Resume/CV.
3. Click/open the resume attachment control if necessary.
4. Re-scan the DOM for:
   - `input[type="file"]`
   - hidden file inputs
   - dynamically created file inputs
5. If a file input exists, use Playwright `setInputFiles(...)`.
6. Use the existing tailored resume for the current job.
7. Verify upload success using visible UI/state where possible.
8. Do not treat the optional Cover Letter upload as Resume.
9. Do not upload a cover letter unless explicitly configured.
10. Do not send a successful resume upload to Human Review.

Do not use coordinates.

### File-input handling

Support:
- visible file input
- hidden file input
- file input created after clicking Attach
- multiple file inputs where association with the Resume/CV widget is required

Do not blindly set the first file input on the page.

---

## 4. Resume Selection

Reuse the existing resume-selection logic.

The resume path must come from the existing generated/tailored resume for the job.

Do not hardcode a PDF path.

If no valid resume path can be resolved, record:

`Tailored resume not available`

Do not ask the user to answer the Resume/CV question if the system can resolve the existing tailored resume.

---

## 5. Duplicate Field Controls

Current Payoneer detection contains duplicate representations such as:

- `Location (City)* Location (City)* Locate me`
- `Location (City)* Locate me`
- `Phone`
- `Phone Phone*`

This causes duplicate review/application handling.

Implement control deduplication.

### Requirements

Group controls that refer to the same logical field using:
- associated label
- `for` → `id`
- name
- aria attributes
- nearby DOM structure
- canonical semantic ID

Prefer the actual editable control over:
- wrapper `<div>`
- display-only text
- duplicate hidden representations
- decorative controls

For a logical field such as `location`, there should be one active field record unless the portal genuinely requires multiple values.

Do not change the semantic meaning rules from Phase 4.8.

---

## 6. Location

The current output still sends Location to review.

Preserve the Phase 4.8 rule:

- Current location → candidate configured current/base location.
- Job/work location → job location.
- Ambiguous location → Human Review.

Do not automatically answer ambiguous location questions just because the word `Location` appears.

However, duplicate representations of the same location control must not create multiple review questions.

---

## 7. Privacy

Keep the Phase 4.8 privacy behavior unchanged.

Privacy/terms acknowledgement must only be automatically answered when an explicit configured behavior or an already approved saved answer exists.

Do not introduce AI/legal interpretation.

---

## 8. Password / Credential Safety

Keep all Phase 4.8 credential protections unchanged.

Never log or persist:
- password
- new password
- confirm password
- credential values
- access tokens

Use only:
`Credential setup required`

when applicable.

Do not print sensitive values in terminal output or JSON.

---

## 9. Review Agent Integration

The existing `review-agent.js` resumes form filling with saved answers.

Keep this behavior.

When the user confirms:

```text
Resume filling matching application forms with saved answers? (yes/no)
```

the flow should:

1. reopen/reuse the application browser context
2. navigate to the job
3. perform portal entry
4. reach the actual form
5. apply saved answers
6. upload the tailored resume
7. stop before final submission

Do not auto-submit.

---

## 10. Expected Results

For SimCorp Workday:

Expected transition:

```text
Apply clicked
→ Start Your Application detected
→ Apply Manually clicked
→ application form detected
→ fields processed
```

For Payoneer Greenhouse:

Expected behavior:

```text
Resume/CV widget detected
→ Attach control opened if necessary
→ file input discovered
→ tailored resume uploaded
→ upload verified
```

The final submit button may be reached, but must never be clicked.

---

## 11. Testing

Run:

```powershell
node scripts/form-agent.js
```

Then, if review questions exist:

```powershell
node scripts/review-agent.js
```

Verify:

### Workday
- Start Your Application modal is detected.
- Apply Manually is clicked.
- Actual form is reached.
- `fieldsDetected` is greater than zero if the form is available.
- `blockedReason` is not the generic pre-modal message.
- No submission occurs.

### Greenhouse
- Resume widget is detected.
- Resume file input is discovered after opening the widget if necessary.
- Tailored resume uploads successfully.
- `resumeUpload.uploaded` becomes `true`.
- Resume does not appear in `humanRequiredFields`.

### Deduplication
- Duplicate Location controls do not create duplicate review questions.
- Duplicate Phone controls do not create duplicate review questions.
- Wrapper `<div>` controls are not treated as independent fields.

### Security
Search output files/logs and confirm no password or credential value is present.

### Regression
Confirm:
- semantic salary mapping still works
- expected salary remains a single configured value
- LinkedIn mapping still works
- notice period mapping still works
- privacy behavior remains unchanged
- final submit is never clicked

---

## 12. Summary

Report:

- Files created
- Files modified
- Workday modal handling implemented
- Workday forms reached
- Greenhouse upload widgets handled
- Resume uploads
- Duplicate controls removed/deduplicated
- Semantic questions resolved
- Questions sent to review
- Blocked applications
- Final submit pages reached
- Testing performed
- Assumptions

## Required Response

Provide a mandatory:

### Next Steps for User

Include:
- exact commands to run
- exact files to inspect
- expected Workday result
- expected Greenhouse result
- security verification
- whether Phase 4.9 passed
- whether it is safe to proceed to Phase 5

Do not implement Phase 5.
Do not submit any application.
