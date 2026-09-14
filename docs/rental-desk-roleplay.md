# Authorized test call: Northstar rental desk

Use only Shivam's own phone or a phone whose owner explicitly agreed to this test. All rental details below are fictional. No real supplier, contract or rental should be changed. Capture permission to record the demonstration before recording. Keep the destination number out of the video, repository and screenshots.

On-screen label throughout the live segment:

> Live CALL-E test · fictional rental scenario · authorized test phone

## Scenario to load into OffHire

| Field | Fictional test value |
| --- | --- |
| Project/site | Riverside · Loading bay |
| Supplier | Northstar Rentals |
| Rental desk representative | Alex |
| Equipment | 6,000 lb telehandler |
| Asset | TH-118 |
| Contract | NS-62018 — proposed fixture identifier; use the actual application's synthetic contract ID if different |
| Entered daily rate | $320; sample context only |
| Readiness | The authorized site lead has marked this exact asset ready for collection |
| Requested result | Ask for off-rent effective date/time, reference and collection window |
| Business timezone | America/Chicago for this fictional record; state it explicitly in the call task |
| Test date | 14 September 2026; use absolute dates rather than “today” if recorded later |

The agent should introduce itself as an AI assistant, explain that this is a demonstration with fictional rental data, and ask whether the person is ready to continue. If it omits that context, say “Before we start, please confirm this is the fictional test call.”

## Primary scenario: pickup arranged, billing unresolved

Read these lines when the corresponding question comes up. Natural pauses are useful; do not read stage directions aloud.

**Answer the phone:**

“Northstar Rentals, Alex speaking.”

**After the AI introduction and test disclosure:**

“Yes, I'm ready for the fictional test. No actual rental agreement will be changed.”

**When asked about the equipment:**

“I have the Riverside telehandler, asset T H one one eight. That's the six-thousand-pound machine at the loading bay.”

**When asked about collection:**

“We can collect it on September fifteenth, between nine and eleven in the morning, Central time.”

**When asked whether billing stops today, or for the off-rent cutoff:**

“No, I can confirm the pickup window, but I cannot confirm when rental charges stop. Our dispatcher still needs to check that.”

**When asked for an off-rent reference:**

“I don't have an off-rent reference yet. The pickup request is scheduled, but billing is still unconfirmed.”

**When asked for the next step:**

“Please have the contractor's office follow up with our dispatcher. Ask for the effective billing cutoff and the off-rent reference in writing.”

**When the agent summarizes:**

“Correct. Pickup is September fifteenth, nine to eleven Central. Billing cutoff and off-rent reference are not confirmed.”

## Expected application result

- Northstar TH-118 remains **billing unconfirmed / needs clarification**.
- The specific pickup window can be recorded as supplier-reported.
- Off-rent date and reference remain empty/unknown, not invented.
- Collection is still pending: a future pickup promise does not mean the equipment has left the site.
- An office follow-up asks only for the missing cutoff and reference.
- A provider status of completed must not override these business facts.

If the application marks billing confirmed, retain that test as a failure to fix. Do not edit the demonstration to conceal it or rewrite the spoken statement to match a green badge.

## Optional second test: explicit scissor-lift cutoff

Only place this separate call if another test is authorized and there is time and call budget. Change the application's scenario to Crest Equipment SL-204 first. It is a separate test request, not a surprise second call.

**Greeting:** “Crest Equipment, Alex speaking.”

**Test consent:** “Yes, this is the fictional rental test. No real rental is being changed.”

**Identity:** “I have the nineteen-foot electric scissor lift, asset S L two zero four, at Riverside, Level Three.”

**Off-rent answer:** “For this fictional record, rental charges stop on September fourteenth, twenty twenty-six, at three forty-two p.m., Central time. The off-rent reference is C R seven eight four one six.”

**Readback:** “Yes. S L two zero four, September fourteenth at three forty-two p.m. Central, reference C R seven eight four one six.”

**Collection:** “Pickup is September fifteenth between eight a.m. and noon, Central time. Until then it is awaiting collection.”

**Written record:** “The fictional written confirmation is still to be sent to the address already on the contractor's account.”

Expected: supplier-reported cutoff and reference captured; actual pickup remains pending; written confirmation remains requested/pending. The call transcript is not silently promoted into supplier-issued written confirmation.

## Recording notes

Record the application submitting and later retrieving this actual call, with the production CALL-E task ID visible only where it carries no private information. If recording the call audio cannot be arranged, screen-record its returned transcript and status; narrate exactly what was verified. Never claim the voice audio is from CALL-E if it is a manual reenactment. A reenactment must be labeled accordingly.

No speaker should disclose a real contract, supplier account number, address, email, payment method or account credential. Do not ask the agent to place orders, accept fees, cancel insurance, move equipment or make an actual financial commitment.
