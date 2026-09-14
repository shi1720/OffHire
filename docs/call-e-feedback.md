# CALL-E feedback from building OffHire

Prepared by Shivam Gupta, 14 September 2026. Based on SDK 0.7.0 inspection and local integration tests. This is not a report of failures observed in a live telephone call.

1. **Signed callbacks would simplify trustworthy completion.** Current callbacks expose event IDs but no verifiable signature. OffHire checks its secret path token and then performs authenticated `calls.get`. Please add timestamped HMAC signatures, key rotation and documented replay tolerance. Include signing/retry examples in both SDKs.
2. **Uncertain create acceptance needs an explicit recovery contract.** A lost response can leave the caller without a Call ID while a real call may be active. We persist the exact body/key and replay it only within the original approval grant. Document idempotency retention duration and provide lookup by client request key or metadata. Tests should demonstrate accepted-then-disconnected recovery.
3. **Cancellation/listing would improve operational controls.** The examined SDK exposes create/get but no cancel or call listing. An operator cannot safely equate a stopped poller with a canceled call. Provide capability/phase-aware cancel and a paginated call ledger for reconciliation.
4. **Task success and business success need explicit examples.** A conversation can complete while billing remains unconfirmed. Examples should show `taskCompleted` alongside a separately validated application result, negative cases, incomplete evidence and contradictory transcript statements.
5. **Transcript naming should be consistent.** The SDK normalizes many fields to camelCase, while a transcript turn retains `offset_seconds`. A documented compatibility shape or consistent typed mapping would reduce integration mistakes.
6. **Align pricing and shared-pool guidance.** Public material examined during research used an older per-minute statement while the September 14 changelog described 10-second call-fee/success-fee mechanics including preparation/unanswered work. Publish one canonical, dated price table and return usage/cost details in the call record so developers can enforce measured budgets.

OffHire's regression harness includes unsigned-body substitution, failed refetch retry, duplicate callbacks, lost acceptance, exact-body replay and stale-poll/terminal races. These can be adapted as reproducible provider integration examples. The application does not claim all these conditions were triggered against CALL-E production.

Sources: [official integrations](https://github.com/CALLE-AI/call-e-integrations), [CALL-E website](https://heycall-e.com/), and [integration contract notes](call-e-integration.md).
