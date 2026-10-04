# Phase 3 — Credential Manager

Implement only this phase.

---

## Goal

Reuse login credentials for supported career portals.

---

## Folder

Create:

config/credentials/

Files:

* linkedin.json
* workday.json
* greenhouse.json
* lever.json

Store email in config.

Password handling should be isolated behind a reusable credential helper.

---

## Behavior

If credentials exist:

* Login automatically.

If missing:

* Ask once.
* Save locally.
* Reuse later.

---

## Constraints

* No cloud storage.
* No browser password scraping.

---

## Success Criteria

Second application to the same portal should not require manual login.
