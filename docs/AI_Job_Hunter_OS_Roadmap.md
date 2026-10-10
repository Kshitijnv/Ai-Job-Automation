# 🚀 AI Job Hunter OS — Project Roadmap

> Open-source, AI-optional job search automation for developers.

This roadmap is designed as a **living checklist**. Most Markdown editors (VS Code, Obsidian, GitHub, etc.) let you click the checkboxes to mark items complete.

---

## 📌 Progress Snapshot

| Metric | Status |
|--------|--------|
| Current Phase | **Phase 1 – Foundation** |
| Search Automation | ✅ Working |
| LinkedIn CLI | ✅ Integrated |
| AI Dependency | ❌ Not Required |

---

# Phase 1 — Foundation

- [x] Create `jobs-today.bat`
- [x] Connect LinkedIn CLI
- [x] Build `search-agent.js`
- [x] Deduplicate jobs by Job ID
- [x] Generate `today_jobs.json`
- [x] Save timestamped search history
- [ ] Create `config/profile.json`
- [ ] Create `config/search.json`
- [ ] Create `config/scoring.json`
- [ ] Create `config/roles.json`

---

# Phase 2 — Job Intelligence

- [ ] Build `fit-agent.js`
- [ ] Rule-based scoring engine
- [ ] Generate `today_jobs_ranked.csv`
- [ ] Apply / Review / Maybe / Skip classification
- [ ] Company blacklist
- [ ] Company whitelist
- [ ] Detect duplicate jobs across history
- [ ] Show only newly discovered jobs

---

# Phase 3 — Job Description Processing

- [ ] Build `jd-agent.js`
- [ ] Download full JD automatically
- [ ] Save Markdown copy of every JD
- [ ] Extract required skills
- [ ] Extract experience requirement
- [ ] Detect work mode (Remote/Hybrid/Onsite)
- [ ] Detect salary (when available)

---

# Phase 4 — Resume Automation

- [ ] Build `resume-agent.js`
- [ ] Generate ATS-friendly Markdown resume
- [ ] Generate PDF using LuaLaTeX
- [ ] Company-specific resume filenames
- [ ] Multiple resume templates
- [ ] Cover letter generator

---

# Phase 5 — Application Automation

- [ ] Build `apply-agent.js`
- [ ] Playwright browser automation
- [ ] Naukri auto-apply
- [ ] LinkedIn Easy Apply assistance
- [ ] Auto-fill application forms
- [ ] Pause before final submit
- [ ] Capture proof screenshot after applying

---

# Phase 6 — Tracking

- [ ] Create `applications.json`
- [ ] Generate CSV tracker
- [ ] Generate Excel tracker
- [ ] Daily report
- [ ] Weekly summary
- [ ] Response-rate analytics

---

# Phase 7 — Notifications

- [ ] Telegram Bot integration
- [ ] Email summary
- [ ] High-score job alerts
- [ ] Daily automation schedule

---

# Phase 8 — AI Enhancements (Optional)

- [ ] Ollama integration
- [ ] ChatGPT integration
- [ ] Claude integration
- [ ] Resume wording improvements
- [ ] Interview question generation
- [ ] Personalized HR answer suggestions

---

# Phase 9 — Open Source Release

- [ ] Write professional README
- [ ] Installation guide
- [ ] Sample configuration files
- [ ] Windows setup script
- [ ] Linux support
- [ ] macOS support
- [ ] Contributing guide
- [ ] License
- [ ] Release v1.0

---

# 🎯 Milestones

## MVP (v0.1)

- [x] Search LinkedIn automatically
- [x] Save clean JSON
- [ ] Rank jobs
- [ ] Generate CSV

## Beta (v0.5)

- [ ] Resume generation
- [ ] JD storage
- [ ] Tracker
- [ ] Notifications

## Stable (v1.0)

- [ ] Multi-user configuration
- [ ] Playwright automation
- [ ] Documentation
- [ ] Open-source release

---

# 💡 Future Ideas (Backlog)

- [ ] Compare today's jobs with yesterday's
- [ ] Resume A/B testing
- [ ] Auto-follow-up reminders
- [ ] Duplicate company detection
- [ ] Interview preparation dashboard
- [ ] Salary benchmark lookup
- [ ] GitHub profile analyzer
- [ ] LinkedIn profile optimization
- [ ] Browser extension
- [ ] Desktop GUI
- [ ] SQLite migration (after JSON proves stable)
- [ ] Plugin system for new job portals

---

# 🏆 Success Criteria

A new user should be able to:

1. Clone the repository.
2. Edit `config/profile.json`.
3. Run `jobs-today.bat`.
4. Search multiple cities and roles.
5. Receive a ranked shortlist.
6. Generate ATS resumes.
7. Track applications.
8. Repeat daily with minimal manual work.

**One command. One profile. One workflow.**
