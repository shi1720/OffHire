# OffHire submission pack

**Project owner:** Shivam Gupta  
**Tagline:** The job is finished. Is the rental?  
**Contribution area:** User-facing Apps  
**Project source:** [github.com/shi1720/call-e](https://github.com/shi1720/call-e)

## Submission links and fields

| Devpost field                   | Final value                                                                                                                     |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Upstream PR URL                 | [Open pull request #664](https://github.com/CALLE-AI/awesome-phone-call-agents/pull/664) — verified open                        |
| Demonstration video             | **[REQUIRED: PUBLIC YOUTUBE OR VIMEO URL, UNDER THREE MINUTES]**                                                                |
| CALL-E account email            | **[REQUIRED: EXACT EMAIL FROM THE CALL-E ACCOUNT]**                                                                             |
| Working demo/test build         | [Deployed OffHire app](https://offhire-shivam.sg127977958.chatgpt.site) — **currently private; public audience choice pending** |
| Devpost username / registration | Verified signed-in Devpost account is registered; draft creation is paused at a CAPTCHA.                                        |

The source is public, the upstream contribution PR is open, and [repository CI passes](https://github.com/shi1720/call-e/actions/runs/34844798171). The hosted synthetic rehearsal has been verified against the deployed persistent database. These checks do not establish a live CALL-E phone call, and the private deployment does not yet establish access for judges. **Devpost has not been submitted.**

The project deadline is **14 September 2026, 21:15 IST / 23:45 SGT / 15:45 UTC**. A saved draft is not a submitted entry. Keep judge access available free of charge through **13 October 2026, 14:30 IST / 17:00 SGT**. [Official rules](https://call-e.devpost.com/rules)

---

## Devpost description

### Inspiration

A crew finishes with a machine. The site asks for collection. The rental desk says a truck will come tomorrow. One question may still be unanswered: when does the supplier say rental billing ends?

That gap inspired OffHire. It helps a contractor's office complete the supplier conversation and retain the result alongside the rental. The useful distinction is simple: a pickup window, a supplier-reported billing cutoff and physical collection are different facts.

IPAF's rental guidance recommends recording off-hire details and a unique reference communicated in writing, then treats collection separately. Supplier terms still govern the actual agreement. OffHire supports that operational handoff without assuming one universal billing rule. [IPAF Rental Standard, sections 9.11–9.13](<https://www.ipaf.org/sites/default/files/2023-12/IPAF%20Rental%20Standard%20(Including%20Guidance%20for%20Rental%20Companies)%20RP-3-EN--V3.1-20231208.pdf>)

### What it does

OffHire gives the contractor a closeout desk for an existing equipment-return request. The operator selects the exact asset, reviews a bounded call plan and asks the rental desk to confirm the effective billing cutoff, timezone and off-rent reference. Collection and written confirmation remain separate questions.

The default Riverside workspace uses fictional records: a $185/day scissor lift, a $320/day telehandler and a $95/day light tower. The displayed rates describe the entered rentals; they are not measured savings or guaranteed accrual.

The telehandler demonstrates the central exception. The supplier can schedule pickup for September 15, 8 AM to noon CDT while still being unable to confirm billing. OffHire keeps that closeout open instead of converting a completed call into a green business outcome.

An evidence receipt connects the result to complete rental-desk transcript turns, shows unresolved questions and distinguishes the conversation record from the supplier's official written confirmation. Six repeatable rehearsal scenarios cover confirmation, unclear billing, voicemail, a later correction, unsupported evidence and the wrong asset.

After a reported cutoff, the operator can compare the invoice's billed-through date against it. A difference becomes a finance review item, since minimum periods, rate tiers or collection charges may explain it. A person separately records written confirmation, physical collection and completed invoice review. The evidence ledger exports JSON for follow-through.

### How we built it

The app uses TypeScript and React with server routes, a persistent database and the actual `@call-e/calle` TypeScript SDK. Live calls use the Calls API with a task and structured result schema. The provider adapter keeps credentials on the server and retrieves the existing call to learn its outcome.

Durable job records preserve the request and idempotency key before dispatch. Uncertain submissions remain visible for recovery using that same request. The live workspace restricts access to approved operators, requires an authorized destination and reviewed plan, and limits concurrency and call budget.

CALL-E callbacks are currently unsigned. The webhook handler uses a callback as a signal to look up a known job and reconcile it through an authenticated provider read. It does not accept callback-supplied business facts as sufficient evidence.

The public rehearsal path uses synthetic data and places no calls. The reusable contribution belongs under `apps/typescript/offhire/` in Awesome Phone Call Agents. [CALL-E Calls](https://docs.heycall-e.com/calls), [webhook documentation](https://docs.heycall-e.com/webhooks)

### Challenges we ran into

The difficult part is deciding what the conversation established. A confident sentence about a truck can leave the financial question unresolved. A later correction can invalidate an earlier answer. The application needs to preserve those distinctions rather than reward every completed call with a success badge.

Recovery creates another challenge. A browser closing or a response being lost does not establish that the phone call failed. Request identity and persistent state matter before sending, not only after a successful response. The interface also needs honest cancellation language: stopping local work cannot cancel a call the provider already accepted.

### Accomplishments we're proud of

OffHire connects a narrow, recognizable phone task to the work that follows it. The interface gives the site team and office the same closeout record while keeping custody, billing and written confirmation separate.

The rehearsal scenarios make the central failure cases easy to inspect. A voicemail, unsupported statement or wrong asset can leave the business result unresolved even when the provider task is marked completed. The product makes that uncertainty actionable instead of hiding it.

### What we learned

The useful unit of success is a complete enough business record. It may require one explicit supplier answer, an office follow-up or a human observation after the call.

The commercial audience is also narrower than “everyone renting equipment.” Contractors or rental brokers coordinating frequent returns across several suppliers have a stronger reason to try this workflow. A company already served well by one supplier's portal may not need it. OffHire focuses on the exceptions and conversations still missing.

### What's next for OffHire

The next step is a measured pilot with contractors handling frequent returns across multiple suppliers. We would compare staff minutes per closeout, time to an explicit supplier cutoff, unresolved cases and call cost against the current process.

A proposed starting price is **$99 per company per month plus actual CALL-E usage**. This is a hypothesis, not validated willingness to pay. As an illustrative model, forty events a month, eight administrative minutes per event and seventy-five percent of that work removed equal four staff hours a month. Customer pilots must test every input. No customers, rental savings or paid demand are claimed.

The open-source workflow remains available for builders using their own CALL-E account. Hosted collaboration, rental-system imports and further invoice-review support are possible next steps after measuring the core workflow.

### Demonstration status

**Use this paragraph unless a real call is verified:**

> The demonstration uses clearly labeled synthetic rehearsals. The server integrates the actual CALL-E SDK, but a real CALL-E phone interaction has not yet been verified. Rehearsal outcomes do not claim supplier transactions, changed rental agreements or financial savings.

**Replace it only after verified live evidence exists:**

> The video includes an actual CALL-E test call to an explicitly authorized phone, with a person playing a fictional rental desk. The returned record demonstrates [INSERT THE OBSERVED OUTCOME]. The remaining sample workspace uses labeled synthetic rehearsals. No real rental agreement or financial saving is claimed.

---

## Final handoff checklist

- [ ] Replace all required placeholders above with verified values.
- [ ] Confirm the code and deployment link show the final submitted version.
- [x] Open the upstream PR in the correct contribution area: [#664](https://github.com/CALLE-AI/awesome-phone-call-agents/pull/664).
- [ ] Copy that PR URL to Devpost. The rules require an open PR; do not delay submission waiting for a merge.
- [ ] Resolve judge access to the currently private hosted app, or supply working test instructions with the submission.
- [ ] Add voiceover to `OffHire-Walkthrough-Silent.mp4` using `OffHire-Walkthrough-Assembly.md`, or record the longer script.
- [ ] Choose the video script's rehearsal or verified-live version. Remove the unused demonstration-status paragraph before pasting the description.
- [ ] Check the video duration is under 3:00 and its public YouTube/Vimeo link plays while logged out.
- [ ] Keep credentials, full real destinations and unrelated account details out of footage and repository history.
- [ ] Enter the exact CALL-E account email in the required form field.
- [ ] Submit the Devpost entry and retain its confirmation.
- [ ] Preserve the submitted materials and free judge access through judging's end.

## Exact remaining user actions

1. **CALL-E access, if live verification is desired:** create or use a project API key in [CALL-E Account → API Keys](https://dashboard.heycall-e.com/account/api-keys), and provide it through the private server-secret setup. Do not paste it into this document, a public repository or the video. The key, live operator authorization and destination allowlist must be configured before real calling.
2. **Authorized phone:** provide an E.164 number you own or have explicit permission to test, with its actual region/locale, and answer the fictional supplier roleplay. Check the exact plan before approving the call. The roleplay is in `OffHire-Video-Script.md`.
3. **Video:** a two-minute generated-narration rehearsal is ready as `OffHire-Narrated-Rehearsal.mp4`, with editable English captions. Listen through it before upload. Shivam can alternatively record the verbatim voiceover. Include an actual authorized call only after verification; keep rehearsal wording while that remains unavailable.
4. **Public video/account fields:** upload the final video, provide its public URL and the exact CALL-E account email, and complete the Devpost entry while signed into the correct account.

These are remaining requirements at the time this pack was written. If a later setup or upload completes one, retain its verified result rather than repeating the action.

## Optional feedback prize

The [CALL-E feedback form](https://call-e.devpost.com/details/feedback) closes **18 September 2026 at 21:15 IST / 23:45 SGT**. Useful researched topics include versioned pricing clarity, unsigned webhook guidance and recovery after a lost create response. Describe documentation findings as findings, and bugs as bugs only when encountered. Pain ratings, future usage intent and permission to contact should reflect Shivam's own answers.
