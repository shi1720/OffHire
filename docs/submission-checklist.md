# OffHire submission checklist

**Deadline: 14 September 2026 at 21:15 IST / 23:45 SGT / 15:45 UTC.** Feedback has a separate deadline: 18 September at the same clock times. Sources: [rules](https://call-e.devpost.com/rules), [overview](https://call-e.devpost.com/).

## Required submission fields

| Item | Value or next action |
| --- | --- |
| Owner | Shivam Gupta |
| Project | OffHire |
| Tagline | The job is finished. Is the rental? |
| Source | https://github.com/shi1720/call-e |
| Upstream contribution | **[CREATE/VERIFY PR URL]** against `CALLE-AI/awesome-phone-call-agents` |
| Contribution area | User-facing Apps: `apps/typescript/offhire/` |
| Devpost username / registration | **[VERIFY FROM THE ACTUAL ACCOUNT]** |
| CALL-E account email | **[VERIFY FROM THE ACTUAL ACCOUNT]**; enter in its required form field |
| Public video | **[UPLOAD YOUTUBE/VIMEO URL]**; less than 3 minutes |
| Working demo/test build | **[VERIFY URL OR REPRODUCIBLE INSTRUCTIONS]** |
| Description | Review `devpost.md` against final implementation before pasting |

## Before creating the final video

- [ ] The app runs from its published setup instructions and the demonstrated workflow works.
- [ ] Real CALL-E mode imports and invokes the actual SDK at runtime.
- [ ] The test destination is owned by Shivam or explicitly authorized for this test.
- [ ] The account key is on the server only, excluded from git and recordings.
- [ ] The real call produced a retrievable task and returned outcome; record the actual status.
- [ ] The roleplay is labeled **Live CALL-E test · fictional rental scenario**.
- [ ] TH-118's pickup window does not produce an invented billing cutoff or reference.
- [ ] A supplier-reported cutoff does not mark the equipment physically collected.
- [ ] Real numbers/private transcripts are not accidentally published.
- [ ] The public demo cannot place unapproved calls or expose private records.
- [ ] Narration only describes shipped behavior; shorten any unimplemented sequence.

**If live testing remains unavailable:** keep fixture labels and explicitly state the missing verification. Do not convert a mock response, a create request or a manual reenactment into a successful-live-call claim.

## Live evidence register — fill only after verification

| Evidence | Actual value |
| --- | --- |
| Date/time and timezone | [PENDING] |
| SDK version | [PENDING: VERIFY INSTALLED VERSION] |
| Test scenario | [PENDING: Northstar TH-118 / Crest SL-204] |
| Authorized destination | Keep private; use a masked value in evidence |
| API call task ID | [PENDING: ACTUAL RETURNED TASK ID] |
| Terminal status | [PENDING] |
| Business outcome | [PENDING: NOT DERIVED FROM TERMINAL STATUS ALONE] |
| Useful returned statement | [PENDING: SYNTHETIC ROLEPLAY WORDS FROM ACTUAL TEST] |
| Test recording filename | [PENDING] |
| Limitations encountered | [PENDING] |

## Repository and PR

- [ ] App source, lockfile, examples and focused checks are present at the stated paths.
- [ ] README documents setup, default no-call behavior, live opt-in, secure credentials, side effects, known limitations and cancellation.
- [ ] Root README and app index contain a concise factual listing.
- [ ] Branch name is checked with the upstream helper.
- [ ] Repository validator passes on the actual submission branch: `python3 scripts/validate_repository.py`.
- [ ] Project-specific build and tests pass; retain exact commands and results.
- [ ] PR description has no unresolved placeholders or false checked boxes.
- [ ] Public PR URL resolves while logged out. An open PR is required; do not wait for merge to complete Devpost entry.

## Final publish checks

- [ ] Video is public on YouTube/Vimeo, is under 3:00 and plays while logged out.
- [ ] Source/demo/PR links resolve and point to OffHire.
- [ ] Devpost entry is **submitted**, not merely saved as a draft.
- [ ] Final receipt/confirmation is recorded.
- [ ] Judge access remains free and usable through **13 October 2026, 14:30 IST / 17:00 SGT**.
- [ ] Submitted materials are preserved at the deadline; later portfolio work does not silently rewrite the judged submission.

## Optional feedback prize

Use the [CALL-E survey](https://call-e.devpost.com/details/feedback) by September 18. Submit one complete account-linked response with documented experience. The strongest current research topics are pricing/version clarity, unsigned webhook guidance and recovering a lost call-create response. Distinguish documentation observations from bugs actually encountered. Do not invent Shivam's pain rating, usage intent or contact preference. Discord sharing is optional.
