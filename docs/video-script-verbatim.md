# OffHire: verbatim rehearsal video script

Presenter: Shivam Gupta. Record a fresh screen walkthrough at https://offhire.web.app. Aim for 2 minutes 40 seconds to 2 minutes 55 seconds, including short pauses. Read only the narration below. The screen directions are not spoken.

This version uses the public synthetic rehearsal. No completed real CALL-E call has been verified. Keep the demo label visible and do not overlay simulated phone audio as a real call. This script is for a fresh recording; the existing two-minute picture track has its own timing in `walkthrough-assembly.md`.

## Narration

Hi, I'm Shivam Gupta, and I built OffHire.

Imagine a construction crew has finished using a rented machine. The supplier says, “We'll collect it tomorrow.” But when do the rental charges actually stop?

OffHire helps the contractor's office get that answer and keep a clear record of what still needs attention.

For this walkthrough, I'm using the public demo with fictional rentals and synthetic conversations. No phone calls are being placed.

Here's our closeout desk. It keeps the supplier's billing confirmation separate from pickup arrangements and actual collection.

I'll select this scissor lift and preview its call plan. The agent must verify the exact equipment and contract, ask for the billing cutoff and reference, read them back, and confirm collection separately.

In live mode, the operator approves the exact destination before CALL-E places the call. Here, I'll run the rehearsal.

The evidence receipt shows the reported billing cutoff, the reference and the supplier's supporting words. Written confirmation and physical collection are still tracked separately.

Now look at the telehandler. Pickup is scheduled, but the supplier has not confirmed when billing stops. OffHire keeps that question open and explains what needs follow-up.

A completed conversation can still leave an unfinished rental.

The rehearsal also covers voicemail, a later correction and answers about the wrong asset. Those cases help test whether the application has enough evidence to confirm anything.

Once a cutoff is reported, I can compare it with the invoice's billed-through date. A difference becomes a finance review item. The team can record collection and written confirmation, then export the evidence.

I built the app with TypeScript, Next.js, Firebase and Google Cloud Run. The live workflow uses CALL-E's SDK, with saved call records, duplicate-dispatch protection and server-side credentials.

The next step is a pilot with contractors managing frequent returns across several suppliers, measuring staff time, unresolved cases and calling costs.

OffHire gives each rental a clear next step and a record the office can use.

The job is finished. Is the rental?

## Screen sequence

Before recording, open Connection, select the demo workspace and choose Reset sample scenario. Confirm that the reset affects only your fictional demo records. Return to the closeout desk. Use readable browser zoom and keep unrelated tabs out of the capture.

| Narration cue | What to show |
| --- | --- |
| “Hi, I'm Shivam Gupta” through “No phone calls are being placed” | Closeout desk with the OffHire name and demo label visible. |
| “Here's our closeout desk” | Point to billing and collection as separate states. |
| “I'll select this scissor lift” | Select SL-204, choose Supplier confirms off-rent, then Preview call plan. Pause over the three questions. |
| “Here, I'll run the rehearsal” | Click Run rehearsal. Then open View evidence receipt. |
| “The evidence receipt shows” | Show the billing cutoff, reference and supporting supplier statement. Do not describe displayed rates as savings. |
| “Now look at the telehandler” | Close the receipt, select TH-118, then View evidence receipt. Show scheduled pickup beside unresolved billing. |
| “The rehearsal also covers” | Close the receipt and briefly open the Rehearsal scenario selector on TH-118. Do not run additional scenarios unless you have time. |
| “Once a cutoff is reported” | Return to SL-204. Choose Check invoice, enter 2026-09-15, then Compare dates. Show the finance review result. |
| “The team can record” | Show the separate Record update choices, then Evidence ledger and Export evidence. Saving a fabricated site observation is unnecessary. |
| “I built the app” | Show Connection or the GitHub README at https://github.com/shi1720/OffHire. No API keys, real phone numbers or private account screens. |
| “The next step is a pilot” through the final line | Return to the closeout desk. End on OffHire and Shivam Gupta, with https://offhire.web.app visible. |

Record a practice read and check the actual duration. The timing is a target, not a measured voiceover duration. Use short pauses for clicks and let the receipt remain visible long enough to read. Upload the final video publicly to YouTube or Vimeo and check playback while signed out before adding its link to Devpost.
