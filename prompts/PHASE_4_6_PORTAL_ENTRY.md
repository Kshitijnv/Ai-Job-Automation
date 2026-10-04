# Phase 4.6 — Portal Entry Logic (MVP)

Read these files first:

* `.codex/PROJECT_RULES.md`
* `.codex/CODING_STANDARDS.md`
* `prompts/PHASE_4_FORM_FILLING.md`

Implement only this integration phase.

---

## Goal

Make each portal responsible for reaching the application form before field detection begins.

Do not submit applications.

Build on the existing Form Agent and portal modules.

---

## Current Problem

The Form Agent reaches the correct portal page but sometimes assumes an extra "Apply" step is required.

Example:

* **Greenhouse (Payoneer):** The application form already exists on the right side of the job page.
* **Workday:** Usually requires clicking an Apply button first.
* **Lever:** Usually requires entering the application form first.

The automation must handle each portal correctly.

---

## Required Flow

Portal Detected

↓

Call `enterApplication(page)`

↓

Portal-specific behavior

↓

Verify application form exists

↓

Run existing form filling

↓

Upload resume

↓

Generate company answers

↓

Collect human-required fields

---

## Portal-Specific Entry Logic

### Workday

* Detect Apply button.
* Click Apply.
* Wait until the application form loads.

### Greenhouse

* Do **not** click an Apply button if the application form is already visible.
* Treat the current page as the application form.
* Improve selector detection for embedded forms.

### Lever

* Detect and enter the application form if required.
* Wait for the form before filling.

Reuse existing portal modules.

Do not duplicate portal detection logic.

---

## Improve Form Detection

Before reporting:

> "No application form controls were found."

the agent must:

1. Wait for the page to finish rendering.
2. Search for fields using multiple strategies.

Supported detection methods:

* Label text (`<label>First Name</label>`)
* `for` → `id`
* `aria-label`
* `aria-labelledby`
* `placeholder`
* `name`
* `id`
* nearest parent form container

Visible labels should be preferred over dynamic IDs.

---

## Retry Logic

If entering the application triggers:

* Login page
* Modal
* New page

continue processing instead of immediately failing.

Reuse the existing Credential Manager.

---

## Better Blocked Reasons

If processing cannot continue, record meaningful reasons inside `review_queue.json`.

Examples:

* Apply button not found
* Login required
* Application form failed to load
* Resume upload control missing

Do not silently produce zero-filled results.

---

## Improved Form Agent Summary

Report:

* Job pages reached
* Apply buttons clicked
* Forms detected
* Fields filled
* Resume uploads
* Company answers generated
* Human-required questions
* Blocked applications

---

## Constraints

* No application submission.
* Preserve existing architecture.
* Reuse existing modules.
* Keep implementation modular.

---

## Success Criteria

* Workday enters the application form automatically.
* Greenhouse recognizes embedded application forms.
* Lever enters the form correctly.
* Form detection becomes label-driven.
* Existing form filling starts automatically after the form is available.
* Resume upload can execute when the control exists.
* Existing pipeline remains intact.

---

## Required Response

Provide:

* Files created
* Files modified
* Testing performed
* Assumptions
* Next Steps for User (mandatory)
