# Phase 4.7 — Navigation Engine (MVP)

Read these files first:

- `.codex/PROJECT_RULES.md`
- `.codex/CODING_STANDARDS.md`
- `prompts/PHASE_4_FORM_FILLING.md`
- `prompts/PHASE_4_6_PORTAL_ENTRY.md`

Implement only this integration phase.

## Goal
Replace exact button matching with intent-based navigation so the agent understands the application flow instead of relying on specific button text.

**Do not submit applications automatically.**

## Navigation Stages

### Stage 1 — Enter Application
- Apply
- Apply Now
- Apply for this Job
- Start Application
- Continue Application

Behavior: Enter the application flow and wait for the form.

### Stage 2 — Continue Between Steps
- Next
- Continue
- Save & Continue
- Review
- Proceed

Behavior: Move to the next step and wait for new fields.

### Stage 3 — Final Submission
- Submit Application
- Submit
- Send Application
- Complete Application
- Finish

Behavior: Detect this stage, never click automatically, and create a Review Queue entry.

## Navigation Registry
Create:

```javascript
const ACTION_BUTTONS = {
  enter: [...],
  continue: [...],
  submit: [...]
};
```

Reuse this registry across all portals.

## Button Detection
Support visible text, `aria-label`, `title`, links styled as buttons, and buttons inside forms. Prefer semantic selectors over dynamic IDs.

## Portal Behavior
- **Workday:** Enter application, continue through intermediate steps, stop before final submit.
- **Greenhouse:** Detect embedded forms, skip unnecessary entry clicks, continue through later steps.
- **Lever:** Enter application, continue through steps, stop before submission.

Reuse existing portal modules.

## Retry Logic
Handle login pages, modals, new tabs, and new pages by continuing after the transition. Reuse the existing Credential Manager.

## Review Queue
Record meaningful blocked reasons such as Final submit reached, Resume required, Portfolio URL required, or Unsupported custom widget.

## Improved Summary
Report Job pages reached, Entry actions performed, Continue actions performed, Final submit pages reached, Fields filled, Resume uploads, Company answers generated, Human-required questions, and Blocked applications.

## Constraints
- No automatic submission.
- Preserve existing architecture.
- Keep implementation modular.

## Success Criteria
- Intent-based navigation works.
- Greenhouse embedded forms continue working.
- Workday and Lever progress correctly.
- Final submit is detected but never clicked.
- Existing pipeline remains intact.

## Required Response
Provide Files created, Files modified, Testing performed, Assumptions, and Next Steps for User (mandatory).
