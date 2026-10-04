# AI Job Search Automation — Coding Standards

Version: 2.0

## Goal

Keep the project readable, maintainable, and easy for contributors to understand.

Favor simple, modular code over clever code.

---

# JavaScript

## Small Functions

Each function should have a single responsibility.

Prefer:

* `loadJobs()`
* `saveResults()`
* `detectPortal()`

Avoid large multi-purpose functions.

---

## Naming

Use descriptive names.

Good:

* `applyAgent`
* `portalDetector`
* `generateDashboard`

Avoid generic names like:

* temp
* data2
* x

---

## No Magic Values

Move reusable values into `config/`.

Examples:

* score thresholds
* browser settings
* search limits

---

## Comments

Comment **why**, not the obvious.

Good:

```js
// Skip duplicate JD downloads
```

Bad:

```js
// Increase counter
i++;
```

---

# Project Structure

Preferred layout:

```text
scripts/
templates/
assets/
config/
output/
data/
```

Reusable utilities belong in:

```text
scripts/lib/
```

Portal-specific automation belongs in:

```text
scripts/portals/
```

---

# JSON

* Pretty-print using 2 spaces.
* Stable key order.
* No trailing commas.

---

# HTML

* Semantic HTML.
* Responsive layout.
* No React for MVP.
* Avoid inline CSS.

---

# CSS

* Reusable classes.
* Simple selectors.
* Mobile-friendly.

---

# LaTeX

Templates must contain valid LaTeX.

Avoid over-escaping commands.

Generated `resume.tex` should remain readable.

---

# Browser Automation

Use Playwright with persistent browser profiles.

Never duplicate login logic across portal files.

Keep browser helpers inside:

```text
scripts/lib/browser.js
```

---

# Error Handling

Fail gracefully.

Examples:

* Missing JD → disable button.
* Missing Resume → hide Resume button.
* Unknown portal → classify as Generic.

Avoid crashing the whole pipeline.

---

# Logging

Each script should print a concise summary.

Example:

```text
Apply Agent Summary

Jobs Processed: 12
Easy Apply: 8
External Apply: 4
```

Keep normal logs short.

---

# Testing

After changing a script:

1. Run the script.
2. Verify generated files.
3. Confirm existing functionality still works.
4. Document the verification steps.
