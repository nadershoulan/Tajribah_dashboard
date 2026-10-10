# Paying by bank transfer, and the payment methods staff control (T129)

Asked by Nader on 2026-10-10: a store can subscribe by **bank transfer** (offline), staff see every request with what
the store sent and attached, **approve or decline** it, and **an email goes out at every step**. Staff can **switch each
payment method on or off** from their own page, so new methods can be added later.

This file is the requirement as built: what it must do (functional), how well and how safely (non-functional), what
was added beyond the request, and where each part lives. Decision record: `docs/DECISIONS.md` → T129.

---

## 1. Functional requirements

### 1.1 Payment methods (staff: «طرق الدفع», `/admin/payment-methods`)

| # | Requirement | Where |
|---|---|---|
| F1 | Every method Tajribah knows is listed: bank transfer, mada, Visa/Mastercard, Apple Pay, STC Bank, Tamara, Tabby. | `lib/payment-methods.ts` (`PAYMENT_METHODS`) |
| F2 | Staff switch a method **on or off**, with a written reason. Stores see only methods that are on. | `updatePaymentMethod` |
| F3 | Staff set the **order** stores see them in. | same, `sortOrder` |
| F4 | A method whose payment gateway is not wired (all online ones today: Moyasar, Tamara, Tabby) **cannot be switched on** — it is shown as "needs its gateway". | `ready` in the registry; refused with 409 |
| F5 | **Adding a method later** = one entry in the registry (+ its gateway). The page, the checkout and the switch need no change. | registry design |
| F6 | Bank transfer has its own settings: grace days after the paid period (default 7), reminder days before the end (default 7 and 2), the review time told to stores (default 24 h), whether a receipt is required (default yes), extra addresses told of each transfer, and instructions shown above the account details (Arabic and English). | `BankTransferConfig` |
| F7 | Staff add, edit, switch off and (if never used) delete **Tajribah's bank accounts**: bank name (Arabic/English), account holder as the bank writes it, account number, IBAN, SWIFT (optional), a staff-only note. | `createBankAccount` … |
| F8 | Bank transfer is offered only when it is on **and** at least one account is active. | `checkoutOptions` |

### 1.2 The store pays (`/dashboard/billing` → checkout)

| # | Requirement |
|---|---|
| F9 | The checkout shows the payment methods that are on, as choices; with only bank transfer on, it is chosen already. |
| F10 | Choosing bank transfer shows the steps, the account(s) to send to (holder, account number, IBAN, SWIFT) each with a **copy button**, and the **amount to transfer** (with VAT, after any coupon). With more than one account the store picks one. |
| F11 | The store attaches the **receipt** (picture or PDF, click or drag and drop, preview), types the **name on the account it sent from** (required), and optionally its bank, the transfer date and a note. |
| F12 | **Buying for a company**: company legal name, VAT number (15 digits, starts and ends with 3), CR number (10 digits). The tax invoice is issued to the company. |
| F13 | A coupon applied in the checkout carries into the request; the server checks it again. |
| F14 | After sending, the store sees a **status card**: reference (copyable), plan, amount, account, sender, the receipt, and the timeline. |
| F15 | While a request is open the store can **cancel** it. One open request per store at a time. |
| F16 | When staff ask for more, the store sees their message and can **send the request again** with a corrected sender name, a new receipt and a reply. |
| F17 | Declined: the store sees staff's reason and can send a new request. Approved: the store sees until when its plan runs and opens the **invoice**. |
| F18 | Earlier requests are listed under the status card (reference, date, plan, amount, status, invoice). |

### 1.3 Staff decide (`/admin/bank-transfers`, «التحويلات البنكية»)

| # | Requirement |
|---|---|
| F19 | Every store's requests, newest first, filtered by status (to review, waiting for the store, approved, declined, cancelled, all) with a **count** for each, and searchable by reference, store or sender. The menu shows how many wait for review. |
| F20 | Opening a request shows the store (link to its page), its current plan, what was requested, price, discount, VAT, **the amount expected in the account**, the account it was sent to, the sender, company details, notes, **the receipt** (a picture inline, a PDF behind a button; open or download), the timeline, and **what approving would grant** (the new period, days carried over). |
| F21 | **Approve** — only after ticking "I checked that X reached the account from Y" — switches the plan on, issues a **paid tax invoice**, records the payment, and tells the store. |
| F22 | **Decline** with words for the store (common reasons offered as a start), optionally a staff note. |
| F23 | **Ask for more** (only while under review), with words for the store. |
| F24 | **Staff note** on any request — never shown to the store. |
| F25 | A link in the staff email opens that request directly (`?open=<id>`). |

### 1.4 Emails at every step (in the reader's language, Arabic first; in-app as well for the store)

| Step | Store's billing people (owner, admin) | Staff |
|---|---|---|
| Request sent | "We have your transfer request" — reference, amount, account, review time | "New bank transfer to check" |
| Staff ask for more | "We need a little more" — staff's message | — |
| Store sends again | — | "Transfer sent again" |
| Store cancels | — | "Cancelled by the store" |
| Approved | "Your plan is on" — until when, the invoice | — |
| Declined | "Could not be accepted" — staff's reason | — |
| Before the end (7, 2 days) | "Your plan ends in N days" — renew by transfer, no day lost | — |
| Period ended | "Paid period has ended" — the store keeps working until the grace day | — |
| Grace over | "Your store is read-only now" — nothing was deleted | — |

Staff recipients: every staff account, plus the extra addresses set on bank transfer.

### 1.5 What approval does (one transaction)

1. The subscription: plan, cycle, **period**, status active, paid by `bank_transfer`.
   - Same plan with paid time left → the new time is added **after** the current end (paying early loses nothing).
   - A different plan with paid time left → starts today; the old plan's paid days are **carried over at their value**
     (10 Growth days ≈ 2 Pro days; 10 Pro days ≈ 100 Starter days).
   - Nothing paid left (trial, ended, expired) → starts today.
   - Annual = 12 months; a coupon's free months are added.
2. The store becomes active — unless staff suspended it (a payment does not undo a suspension).
3. A **paid tax invoice** for exactly the amounts the store was quoted (company as buyer when it bought for one).
4. A captured **payment** (method `bank_transfer`, the reference as its provider id).
5. The plan change in the store's own activity trail; the request approved with its invoice and period; the timeline.
6. After it: the coupon's redemption names the invoice, the staff trail row, the shop's buttons refreshed (plan
   features), the store told.

### 1.6 Renewal (plans paid by transfer do not renew themselves) — every minute

Reminders (nearest one only, once) → **past due** at the end (still working) → **read-only** after the grace days
(the shop's buttons stop; nothing deleted). Never read-only while a renewal transfer waits on staff. Renewing brings
everything back.

---

## 2. Non-functional requirements

| # | Requirement | How it is met |
|---|---|---|
| N1 | **The server is the authority on money.** The browser's quote is never trusted. | Prices from the plan rows, the coupon re-checked, VAT by the shared contract; the request keeps the amounts as quoted; approval refuses if the invoice would differ. |
| N2 | **No double activation, no lost update.** | Approval locks the request and the subscription in one transaction; a second approval finds it closed (409). Payment idempotency key `bank_transfer:<id>`. |
| N3 | **One open request per store.** | Partial unique index in the database, not only a check in code. |
| N4 | **A coupon's last use cannot go to two stores.** | Redeemed (row-locked) when the request is sent; given back on decline or cancel. |
| N5 | **Tenant isolation.** | Requests and timeline are tenant tables with row-level security (FORCE); the isolation suite covers them automatically; a store reading another's request or receipt gets 404. |
| N6 | **Receipts are private.** | Stored under the store's prefix with an unguessable key that never leaves the server; served only through the server to the store or staff (`no-store`, `nosniff`, a sandboxing CSP, inline/attachment). |
| N7 | **Receipts are what they claim.** | Judged by their first bytes (PNG, JPEG, WebP, PDF), 200 B – 10 MB; anything else is deleted at once. Uploads go straight to storage at a signed address (type and size signed in); never-sent uploads are swept after a day. |
| N8 | **IBAN typed right.** | ISO 13616 mod-97 check and the Saudi shape before an account is saved; unique. |
| N9 | **Every staff action is accountable.** | Staff trail (reason required for settings and accounts), the store's own activity trail for plan changes, and an **append-only** timeline (the application role cannot edit or delete events). |
| N10 | **Abuse limits.** | 20 requests/uploads an hour per store; staff endpoints need staff with two-step sign-in, same-origin writes. |
| N11 | **Tax compliance.** | The invoice comes from the existing issuer: gapless numbers, seller and buyer snapshotted, VAT 15% only from SRO's VAT date. |
| N12 | **Honest UI.** | Methods that cannot take money are not offered; the store is told plainly what happens next and when. |
| N13 | **Arabic first, bilingual, phones.** | All copy Arabic and English; every screen works at 390 px (single column). |
| N14 | **Extensible.** | Registry of methods; config per method; the period rule and statuses are shared code. |
| N15 | **Tested, and seen to fail.** | Contract tests (IBAN, reference, receipt bytes, periods, settings) and end-to-end tests on real Postgres; each rule broken on purpose is caught (see STATE.md). |

---

## 3. Beyond the request (decided, so it works in real life)

- **Renewals** for offline payments (reminders, past due, grace, read-only) — without them a transfer plan never ends.
- **Ask for more / send again**, not only approve or decline — most problems are a cropped receipt or a name.
- **Cancel** by the store; **staff notes**; a **timeline** both sides read.
- **Buying for a company** (from the reference screen): the invoice carries the company.
- **Change of plan** carries paid days over; **early renewal** loses nothing.
- **Suspension** is never undone by a payment.
- **Coupons** work with transfers and are held fairly.
- The **reference** (`TJR-XXXXXX`) uses characters that cannot be misread on a statement.
- Receipts are **kept** after a decision (the record of a payment); a replaced one is deleted.

## 4. Not in this version (next steps)

- Online methods (mada, cards, Apple Pay, STC Bank) — need the Moyasar account (P2.3); Tamara and Tabby need their own
  merchant accounts. Each becomes "ready" in the registry when wired; staff then switch it on.
- Matching transfers automatically from the bank statement (a bank API or a statement upload).
- Refunds of a transfer (today: by hand, outside the app).
- Retention period for old receipts (kept for now with the invoice records).
