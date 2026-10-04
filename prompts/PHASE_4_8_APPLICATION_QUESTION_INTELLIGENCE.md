# Phase 4.8 — Application Question Intelligence & Reliability (MVP)

Read these files first:

- `.codex/PROJECT_RULES.md`
- `.codex/CODING_STANDARDS.md`
- `prompts/PHASE_4_FORM_FILLING.md`
- `prompts/PHASE_4_6_PORTAL_ENTRY.md`
- `prompts/PHASE_4_7_NAVIGATION_ENGINE.md`
- `prompts/PHASE_5_HUMAN_REVIEW_QUEUE.md`

Implement only this phase.

## Goal

Make the existing application form automation reliable enough that only genuinely unknown questions reach the Human Review Queue.

Do not add application submission.

## 1. Dynamic Form Readiness

Forms may load after initial navigation because of network latency or client-side rendering.

Implement reusable condition-based readiness:
- wait for page availability
- allow client-side rendering to settle
- wait for actual application-form controls where possible
- configurable maximum timeout
- meaningful failure reason

Do not rely only on a fixed `setTimeout`. Prefer `waitForSelector`, polling, visible controls, and portal-specific readiness signals. A short settling delay may supplement these checks.

## 2. Semantic Question Mapping

Create or extend a reusable semantic question mapper, preferably:

`scripts/lib/question-mapper.js`

Map equivalent wording to canonical IDs.

Examples:

| Raw question | Canonical ID |
|---|---|
| Current CTC | `current_salary` |
| Current annual compensation | `current_salary` |
| Current annual base compensation | `current_salary` |
| Present salary | `current_salary` |
| Expected CTC | `expected_salary` |
| Expected annual compensation | `expected_salary` |
| Expected annual base compensation | `expected_salary` |
| Notice period | `notice_period` |
| LinkedIn Profile | `linkedin_url` |
| Phone | `phone` |
| Phone Country | `phone_country` |

Use semantic meaning, not exact string equality.

## 3. Trusted Answer Sources

After canonical mapping, resolve from this priority:

1. `config/application.json`
2. `profile.json`
3. Existing resume/profile data
4. Existing credential store where appropriate
5. Company/job-specific data
6. Human Review Queue

Do not ask again when wording changes but meaning is already known.

## 4. Salary

Map current-salary variants to `current_salary`.

Map expected-salary variants to `expected_salary`.

Do not introduce `expectedMin` or `expectedMax`.

Application forms receive the single configured expected CTC value.

## 5. Other Known Questions

Recognize common variants of:

- Notice Period → `notice_period`
- LinkedIn Profile → `linkedin_url`
- Phone → `phone`
- Phone Country → `phone_country`
- Current City / Current Location → `current_location`
- Willing to Relocate → `willing_to_relocate`
- Work Authorization → `work_authorization`
- Visa Sponsorship → `visa_sponsorship`

Never invent missing values.

## 6. Location Semantics

Distinguish current location from job/work location.

Current-location questions use the candidate's configured base/current location.

Job/work-location questions use the job location where appropriate.

If genuinely ambiguous, send to Human Review rather than guessing.

## 7. Resume/CV

Recognize:

- Resume
- Resume/CV
- CV
- Upload Resume
- Attach Resume

Use the existing tailored resume automatically.

If upload succeeds, do not add it to Review Queue. If it fails, record a meaningful reason.

## 8. Privacy / Terms

Recognize privacy-policy and terms acknowledgements separately from candidate questions.

Use explicit configured behavior if present.

Do not make legal/consent decisions using AI. If no explicit automation policy exists, require review.

## 9. Credential and Password Protection

Never expose passwords or credential values in:

- terminal output
- `form_review.json`
- `review_queue.json`
- logs
- dashboard output
- errors

Password fields must never become ordinary review questions.

Reuse the existing Windows Credential Manager.

If credential setup is required, report only:

`Credential setup required`

Never record the password.

## 10. Sensitive Redaction

Protect at minimum:

- password
- new password
- confirm password
- credential
- access token
- authentication token

Log metadata only, for example:

```json
{
  "field": "password",
  "status": "detected",
  "value": "[REDACTED]"
}
```

## 11. Review Agent Fix

Fix:

`reviewQueue.answeredQuestions is not a function`

Inspect the existing `review-queue.js` API and use its actual interface.

Test:
1. Load queue.
2. Answer question.
3. Persist answer.
4. Read answered questions.
5. Run Review Agent again without crashing.

## 12. Review Queue

Only unresolved questions after semantic mapping should enter:

`output/review_queue.json`

Equivalent questions must not create duplicate entries.

## 13. Summary

Report:

- Job pages reached
- Forms detected
- Fields detected
- Fields filled
- Semantic questions resolved
- Questions sent to review
- Resume uploads
- Company answers generated
- Login attempts
- Successful logins
- Blocked applications
- Final submit pages reached

## 14. Testing

Test:

- Form appearing after a delay.
- Current CTC / current annual compensation / current annual base compensation.
- Expected CTC / expected annual base compensation.
- Resume / Resume-CV / Upload Resume.
- Password redaction.
- Review Agent queue load, answer, persistence, and second run.

## Constraints

- No application submission.
- Do not change portal detection unnecessarily.
- Reuse existing modules.
- Do not duplicate credential logic.
- Do not invent candidate information.
- Do not expose credentials.
- Keep MVP scope focused.

## Success Criteria

1. Dynamically loaded forms are reliably detected.
2. Equivalent salary questions resolve to configured values.
3. Equivalent questions do not create duplicate review entries.
4. Resume fields are handled automatically.
5. Passwords never appear in logs or output.
6. Privacy questions follow explicit configured behavior.
7. Location questions use semantic meaning.
8. Review Agent no longer crashes on `answeredQuestions`.
9. Only genuinely unknown questions reach Phase 5.

## Required Response

Provide:
- Files created
- Files modified
- Testing performed
- Assumptions
- Next Steps for User (mandatory)

The Next Steps section must include exact commands, files to inspect, expected output, manual verification steps, and whether to proceed to Phase 5.
