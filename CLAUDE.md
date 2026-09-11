# Exec Meeting Scheduler

Executive meeting booking system for internal team use. Repo: github.com/Jupiiter-ju/exec-meeting-scheduler

## Architecture

Three pieces, all driven by one shared n8n backend workflow:

1. **Website** (`index.html`) — single-file HTML/CSS/JS, no build step. Calls the n8n webhook directly via `fetch`. The only file tracked in this git repo.
2. **Discord bot** ("น้องจู" / Agent-Ju) — an n8n AI Agent node (Google Gemini model) that talks to users in Discord DMs and calls the same backend via tool nodes (`check_availability`, `book_meeting`, `book_multi_meeting`, `find_my_meeting`, `cancel_meeting`, `cancel_batch_meeting`).
3. **n8n backend workflow** — not stored in this repo (n8n has no direct API access from this environment). Writes to Google Calendar and logs to Google Sheets. The user exports/pastes node code manually when it needs inspecting or editing (see workflow note below).

### Data stores
- **Google Calendar**, 3 calendars: `exe` (คุณกฤช), `combo` (คุณเบียร์), `agenix` (Agenix/AGX company bookings always land here regardless of which exec).
- **Google Sheet "Record Appointments Exec - Bot"**, tabs:
  - `ChatLog` — every Discord message + bot reply, logged for debugging.
  - `BookingLog` — booking records with a `Status` column (Active/Cancelled) kept in sync by a separate scheduled workflow.
  - `AddressBook` (added 2026-09) — nickname → email lookup for auto-inviting meeting participants by email. Columns are English (`Nickname`, `Email`) because Thai text cannot be typed into Google Sheets' canvas grid via browser automation (see Gotchas).

### Identity model
- Discord bot: `Resolve Employee` node maps the message's real Discord `authorId` to a name/email/company via a hardcoded `EMPLOYEE_MAP` in code — the AI can never impersonate another user because `callerName`/`requesterEmail` sent to every backend tool call are hardcoded n8n expressions (`{{ $('Resolve Employee').item.json.employeeName }}`), not model-fillable fields.
- Backend authorization for cancel/find matches by checking whether the caller's own name/email appears anywhere in the target event's description (organizer *or* participant — not restricted to "the person who booked it").
- Website: caller name/email come straight from the form, no Discord identity involved. A `source: 'website'` field is included on every website webhook payload specifically so backend logic can special-case website vs. Discord behavior.

## Workflow rules (apply every session, no need to re-ask)

- **Respond in Thai.**
- **`index.html` changes**: commit and push straight to `master` (no feature-branch step). Always syntax-check first:
  ```
  node -e "const fs=require('fs'); const html=fs.readFileSync('index.html','utf8'); const m=html.match(/<script>([\s\S]*)<\/script>/); new Function(m[1]); console.log('OK');"
  ```
- **n8n backend changes**: no direct access. Give the user exact copy-paste code (old string → new string, or full node body) for them to paste into the node themselves; they paste the result back for verification. Never assume a change landed without seeing it pasted back.
- **Prefer additive, narrowly-scoped changes** to backend nodes — this system is in active production use (real people booking real meetings with executives). A shared node feeding every action branch (e.g. inserting a lookup node between the webhook trigger and the router) can take down the *entire* bot if it errors, not just the feature being added. Test new nodes in isolation (Execute Step with pinned/mock data) before wiring them into the live path.
- **Google Sheets cannot be edited via browser automation** — neither the in-app browser nor Claude in Chrome can type into Sheets' canvas-rendered grid (keystrokes silently don't register; this is not an auth issue, confirmed by testing on a fresh session in real Chrome too). Ask the user to type Sheet edits themselves.

## Known gotchas (already root-caused once — don't re-diagnose from scratch)

- **Mobile Thai IME breaks if you reassign `el.value` on every `input` event.** Any live-filtering input handler (e.g. Thai-only character enforcement) must skip filtering while `compositionstart`/`compositionend` is in progress, or mobile keyboards can't type multi-character Thai words into the field at all.
- **Split participant/name lists on `/[,\s]+/`, not just `,`.** Users often separate names with a space instead of a comma; nobody's nickname in this system contains an internal space, so splitting on either is safe and prevents "two names glued together" bugs.
- **Normalize Thai strings with `.normalize('NFC')` before comparing for equality.** Text typed on different devices/keyboards can encode the same visible string with different Unicode composition, breaking naive `===`/`.includes()` dedup checks (this caused a name to be duplicated in event titles).
- **The AI Agent occasionally returns a genuinely empty `output` with no tool call**, even though the n8n execution shows "Succeeded" — Discord then shows the hardcoded fallback from `Discord: ตอบกลับ`'s `content` field ("ขอโทษค่ะ ระบบขัดข้องชั่วคราว รบกวนพิมพ์คำสั่งเดิมซ้ำอีกครั้งได้ไหมคะ..."), and retyping the confirmation word doesn't help — same failure repeats. Confirmed via Executions → AI Agent node → Logs → `Google Gemini Chat Model` sub-step → Output → **JSON** view: `finishReason: "STOP"` with `completionTokens: 0` (promptTokens ~9,140 — not near any token ceiling, so **not** a `MAX_TOKENS` truncation, and no `promptFeedback.blockReason` either, so **not** a safety-filter block). An identical-looking booking (same confirm step, same shape) from a different user succeeded seconds apart, confirming this is a genuinely random/intermittent empty-response glitch on Gemini's side, not something triggered deterministically by our prompt/tool setup.
  - **2026-09 mitigation that resolved it in practice**: on the `Window Buffer Memory` node, reduced `contextWindowLength` from 30 → 10, and changed the session `Key` from `={{ $('Resolve Employee').item.json.authorId }}` to `={{ $('Resolve Employee').item.json.authorId + '_' + $('Resolve Employee').item.json.todayDate }}` — this resets each user's conversation memory daily instead of letting it accumulate indefinitely. Theory: long/stale accumulated history was making the empty-response glitch more likely to surface, even though raw prompt token count alone didn't look excessive.
  - **Not yet applied** (kept as a documented fallback in case the glitch recurs): an auto-retry path — duplicate `AI Agent` → `AI Agent (Retry)`, wire the same `Google Gemini Chat Model`/`Window Buffer Memory`/6 tool nodes into it, insert an `IF` node (`{{ $json.output }}` is empty) between `AI Agent` and its two children (`Discord: ตอบกลับ`, `Log Chat`) — false branch keeps going to those two unchanged, true branch routes to `AI Agent (Retry)` which also feeds those same two nodes. Because the IF's "empty" branch only carries `{ output: "" }` (not the original `message`/`employeeName`/`employeeEmail`/`employeeCompany`/`todayDate` fields), `AI Agent (Retry)`'s `text` and `systemMessage` expressions must be rewritten from `$json.xxx` to `$('รู้จักไหม').item.json.xxx` or it will error every time it's invoked.
- **n8n node renames are safe** — renaming via the UI (double-click the node title) auto-updates every `$('OldName')` expression reference elsewhere in the workflow. Router/Switch nodes in particular are never referenced by name downstream, so renaming them is essentially risk-free.
- **Batch/package booking (`book_multi`, website "นัดหมายเป็นชุด") could silently drop trailing dates with zero error shown.** Reported case: booked every Tuesday from 1 ก.ย. to 29 ธ.ค. 2569 (16 bookable days after 1 holiday excluded) — the confirmation page showed "จองสำเร็จ 5/5 วัน" and listed only the 5 September Tuesdays; October–December (12 days) vanished from *both* the "booked" and "จองไม่สำเร็จ" lists, with no error surfaced anywhere. Root cause not confirmed with execution logs (too old to find by the time it was reported — **check Executions soon after a report like this, they age out**). Leading theory: `Create Event (Multi)` calls Google Calendar once per date sequentially; if one call errors partway through and the node's `On Error` was left at the n8n default (`Stop Workflow`), items after the failure point never reach `Aggregate Multi Results` at all — they aren't recorded as booked *or* failed, they just never get processed.
  - **2026-09 fix applied** (not yet re-confirmed against a live repro, but strictly safe/additive — behavior for the all-success case is unchanged): set `Create Event (Multi)`'s node Settings → **On Error: Continue**. Rewrote `Aggregate Multi Results` to check each item for `.json.error` (set by n8n when a "Continue"-on-error item fails) and route those into `failed` (merged with the pre-existing `decide.conflicts` list) instead of assuming every item that reaches the node succeeded.
  - If this resurfaces, check the execution **immediately** (Executions → `Create Event (Multi)` node → compare input vs output item count, look for a red/error item) before it ages out of the retention window.

## In progress / not yet built

- **Auto-invite by address book** (Discord only, gated on `source !== 'website'` so the website's behavior never changes): look up each named participant in the new `AddressBook` sheet; exactly one match → invite automatically; no match → stay silent; multiple matches (ambiguous nickname) → block the booking and have the AI ask which one / for the email, then retry with `inviteEmails` filled in. Design is agreed; the actual node code (`Build FreeBusy Request (Book Guard)`, `Compute Multi Availability & Decide`, `AI Agent` prompt) has not been written/sent yet. The `Read Address Book` Google Sheets node exists in the workflow but is currently *disconnected* from the main path — reconnecting it requires first fixing a stale sheet-ID reference (reselect "AddressBook" from the node's Sheet dropdown to refresh it) and testing it in isolation before wiring it between `Exec Meeting Booking` and `Route by Action`.
