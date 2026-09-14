# OffHire business case

**The job is finished. Is the rental?** OffHire helps contractor teams resolve missing or ambiguous off-rent confirmations across suppliers. It preserves what the rental desk says, keeps pickup separate and gives finance a cutoff/reference to review against an invoice.

Research date: 14 September 2026. This is a product hypothesis supported by public workflow evidence, not customer interviews, validated revenue or measured savings.

## A narrow operational problem

A site lead requests a return. The office hears “pickup tomorrow,” yet lacks an explicit billing cutoff or off-rent reference. Someone must call, identify the exact asset/contract, separate billing from collection, write down the answer, and pass it to finance. The agent's useful output is that supported record, including an unresolved result when the representative cannot confirm it.

The [IPAF Rental Standard, §9.11–9.13](https://www.ipaf.org/sites/default/files/2023-12/IPAF%20Rental%20Standard%20(Including%20Guidance%20for%20Rental%20Companies)%20RP-3-EN--V3.1-20231208.pdf) describes off-hire reference handling and written communication separately from collection. Supplier terms differ: [United Rentals](https://www.unitedrentals.com/legal/rental-service-terms-us) and [Conquest](https://www.conquestequipment.net/rentals/terms-and-conditions/) illustrate why one universal “a call stops charges” rule would be inappropriate. These sources establish a process, not OffHire's demand or a customer's legal position.

## Buyer and alternatives

The proposed buyer is an operations or commercial manager at a contractor or rental broker coordinating multiple suppliers. The initial use case is the exception queue: existing off-rent requests without complete confirmation. Existing portals should handle straightforward returns.

| Alternative | What it already solves | OffHire's proposed role |
|---|---|---|
| [United UR Control](https://www.unitedrentals.com/our-company/customer-care/faqs) | Supplier account management and off-rent requests, available free | Resolve other suppliers and incomplete confirmations |
| [Equipbase](https://www.equipbase.co.uk/off-hire-management) | Contractor off-hire tracking, collection status and invoice-query records | Complete the phone conversation alongside existing tracking |
| [CallEquip](https://callequip.ai/) | Voice automation for rental businesses | Focus on the contractor's cross-supplier closeout record |
| Spreadsheet and phone | Familiar, flexible manual coordination | Reduce repeated calls, transcription and handoff work |

This is not the first rental tracker or rental voice product. The potential advantage is a consistent evidence record across suppliers and careful handling of ambiguous outcomes. Defensibility would need to develop through workflow integrations, repeat usage and validated operational data; it does not exist simply because CALL-E is integrated.

## Pilot offer and economics

Proposed pilot: **$99/company/month plus measured CALL-E usage at cost**, with one operator workspace and a bounded call allowance. Price, demand and retention are unvalidated. Current provider numeric rates were not confidently established across changing public materials, so the product does not promise a universal per-minute price.

Illustrative monthly case: 40 exception events × 8 minutes manual administration × 75% reduction = 240 minutes, or 4 staff hours. At an assumed $40/hour, that is $160 of modeled time value before the $99 fee and actual call usage. This model excludes equipment-charge recovery, setup effort, failed calls and ongoing support. Measure those before making a purchase claim.

The on-screen Riverside demo has three fictional rentals: scissor lift $185/day, telehandler $320/day and light tower $95/day. Initial entered rates awaiting confirmation total $505/day; confirming the lift leaves $320/day. This metric sums entered rates attached to unresolved evidence. It is neither accrued loss nor recovered savings.

## Validation plan

Interview five contractor operations/finance teams using several suppliers. Ask for anonymized recent return records and observe how missing confirmations are resolved. Run a consented concierge pilot with three teams and roughly 20 exception events each. Measure baseline administration time, confirmed-cutoff coverage, human review rate, call duration/fees, false confirmations, written-confirmation completion and invoice handoff.

Proposed continuation gates: zero observed false confirmations in reviewed pilot cases; a meaningful measured reduction in administration; two teams willing to pay the proposed price; and a support/usage cost envelope that permits sustainable margins. These are proposed gates, not achieved results. If portals already cover the workload or exception volume is too low, narrow the buyer or stop.

## What the MVP ships

A persisted rental closeout desk; one-asset approved call plans; official SDK create/get; exact-body idempotency and recovery; transcript-grounded billing/collection evidence; manual written-confirmation and collection attestations; invoice-end-date flags; audit and JSON evidence export. Six labeled synthetic rehearsals make the workflow inspectable without using telephone credits.

Before production: real supplier pilot, authorized number provisioning, monitoring, retention and abuse controls, measured costs, accessible operating procedures and provider reliability validation. Future integrations are hypotheses: supplier portals, rental accounting/ERP import, invoice attachment parsing and follow-up scheduling are not claimed as shipped.
