# Phase 5 — Human Review Queue

Implement only this phase.

---

## Goal

Batch human-required questions across multiple applications.

No popups.

---

## Example

Instead of asking salary 9 times:

Ask once.

Reuse everywhere.

---

## Output

Create:

`output/review_queue.json`

Example:

```json
{
  "Current CTC":{
    "jobs":7
  }
}
```

---

## Resume Behavior

Pause all applications.

Collect answers.

Resume automatically after confirmation.

---

## Success Criteria

One answer updates every matching application.
