# AI Job Search Automation — Project Rules

Version: 2.0

## Purpose

This project is a **local-first AI Job Search Automation system** that helps users search jobs, generate tailored resumes, automate applications, and track application history.

Every implementation must preserve the existing working pipeline.

---

## Current Stable Baseline

These features are considered complete and must not be broken:

* Search Agent
* Fit Agent
* JD Agent
* Resume Agent
* Dashboard Agent
* `jobs-today.bat`

Treat these as production-ready MVP components.

---

## Core Principles

### 1. Local First

Everything should work locally.

Prefer:

* Local JSON
* Local HTML
* Local JavaScript
* Local files

Avoid unnecessary cloud services.

---

### 2. MVP First

Build working software before adding polish.

Ask:

> Does this feature directly help users apply for jobs faster?

If not, postpone it.

---

### 3. Do Not Refactor Unrelated Code

Only modify files required for the current task.

Do not redesign working architecture.

---

### 4. Configuration Over Hardcoding

User-specific values belong in `config/`.

Examples:

* profile.json
* search.json
* scoring.json
* browser.json
* credentials/

Never hardcode personal information inside scripts.

---

### 5. Preserve Truthfulness

Never invent:

* experience
* certifications
* achievements
* technologies used professionally

Resume generation must remain factually accurate.

---

### 6. Professional vs Academic

Keep these separate.

Professional:

* T-Systems

Academic:

* Mr Buddy

Never merge them.

---

### 7. Browser Automation Rules

When automating applications:

* Reuse the user's logged-in browser profile.
* Never automate LinkedIn login.
* Never bypass authentication mechanisms.
* Store reusable configuration in `config/`.

---

### 8. Shared Repository Friendly

Assume friends and colleagues will use this project.

Features should require:

* minimal setup
* reusable configuration
* no personal hardcoded values

---

### 9. Output Philosophy

Generated files belong in `output/`.

Source templates should never be overwritten automatically.

Examples:

* dashboard.html
* resume.pdf
* apply_candidates.json

---

### 10. Completion Checklist

Every completed task must include:

* Files created
* Files modified
* Testing steps
* Assumptions made

### 11. User Action Handoff (Mandatory)

Every completed task must end with a **Next Steps for User** section.

It must include:

- Commands to run
- Files to edit (if any)
- Manual verification steps
- Expected outcome

Never assume the user knows what to do after implementation.