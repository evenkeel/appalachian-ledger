# Planned bills and payment matching

The Expenses workspace keeps the Sunday–Saturday dots and now lists bill names, amounts and overdue status beneath them. **All planned bills** opens the next unrecorded occurrence of every saved bill, including dates outside the selected week. These are saved schedule dates, not inferred bank charges or future repetitions.

## Variable amounts

Choose **Mark paid** beside a bill, change the payment amount/date if needed, then **Confirm payment**. An overdue bill defaults to its due date; an early payment defaults to today. The payment date cannot be in the future. A $100 power-bill estimate can therefore produce a $112.37 actual expense without changing the $100 estimate for the next occurrence. Edit the bill schedule separately to change that standing estimate.

Confirmation records the actual expense and advances the schedule using its existing calendar anchor. Failed requests preserve entered values; safe retries do not record the same occurrence twice. If exactly one unused recorded expense already matches the selected account, actual amount, payment date and normalized bill name, confirmation links that entry instead of creating a second expense. Multiple candidates require review in Transactions. Matching does not change the original entry, category, postings or conversion snapshots.

## Automatic matching

Opening or refreshing a bill workspace checks recorded/imported expenses using authenticated, CSRF-protected `POST /api/recurring-bills/reconcile`, optionally scoped to an account. A unique expense and unique active schedule must agree on account, amount, due date and name. Name comparison normalizes case, Unicode and whitespace; it does not infer merchants from loosely similar descriptions. Expenses already linked to any bill and reversed expenses cannot be reused. Multiple candidates remain unmatched. Repeated rounds can catch up a schedule over several already-recorded months, up to 1,000 matches per request.

A match adds an occurrence link, advances or completes the schedule, and creates an audit event. It does not post an expense. Repeated checks are idempotent. This is matching during app use, not unattended due-date posting or bank synchronization. Different-amount variable bills stay available for manual review; confirming the actual amount can link an existing exact payment.

No database migration or new dependency is required. Existing backups include schedules, occurrence links and audits. A local snapshot was taken before enabling this workflow; browser checks only opened/cancelled payment forms and did not record personal payments.
