# ChiefOS

An AI Chief of Staff for executive visibility, blocker escalation, decisions and daily planning.

This is a **local prototype on fictional data**. It runs with no paid API key, no cloud account and no
model download. Extraction runs on a deterministic rules engine; the socket where an approved internal
model would plug in is a single file (`src/lib/ai/llm.ts`) and is labelled as empty in the top bar of
every page.

---

## Running it

Requires Node 22.13+ (for the built-in `node:sqlite`). Built and tested on Node 24 / Windows 11.

```bash
npm install
npm run seed
npm run dev
```

Open <http://localhost:3000>. The Command Center is the opening screen.

**For a demo, run a production build instead** - `next dev` recompiles under you and stutters at the
wrong moment on a memory-constrained machine:

```bash
npm run build
npm start
```

| Command | What it does |
| --- | --- |
| `npm run seed` | Creates `data/chiefos.db` and fills it with the fictional workspace |
| `npm run reset` | The same thing; the name exists so the intent reads clearly |
| `npm run test` | Runs both gates below |
| `npm run test:extract` | Extraction corpus - at least 4 of 7 parse usefully, the rest must ask rather than invent |
| `npm run test:schedule` | Schedule placement, assumption marking and conflict detection |
| `npm run lint` / `npx tsc --noEmit` | Both clean |

The database file is git-ignored. The **Reset demo data** button in the top bar runs the same seed code,
so the counts after a reset match the counts you rehearsed with.

---

## The four surfaces

| Route | Who | What it does |
| --- | --- | --- |
| `/` | CEO | Command Center: KPIs computed from records, project health with drill-down, high-priority blockers with their priority reasons, schedule preview, recent updates and activity |
| `/decisions` | CEO | Decision Inbox: original wording beside the extracted fields, why each item is prioritised, an editable draft response, approve-and-send or ask-for-clarification |
| `/employee` | Team | Workspace: write an update, review what was read from it, correct any field, submit; inbox with acknowledgement |
| `/schedule` | CEO | Type the day's priorities, get proposed blocks with assumptions marked and overlaps flagged, edit, approve |
| `/activity` | Audit | Flat reverse-chronological audit trail |

---

## The guardrails, and where they live in the code

These are the product, not decoration. Each one is enforced in a specific place:

- **Nothing sends or closes without a human.** `approveDecision` in `src/lib/actions.ts` is the only path
  that creates a message, and it requires an explicit approval action carrying the approver's id.
- **Acknowledgement is not resolution.** `acknowledgeMessage` writes `acknowledged_at` and nothing else.
  Only `resolveBlocker` reaches `status = 'resolved'`, and the UI says so beside both buttons.
- **The original transcript is immutable.** `updates.original_text` is written once; the extracted fields
  are a separate editable record (`extracted_json`) that references it. Both are shown side by side.
- **Absence is representable.** Every field in `extractionSchema` is nullable. A missing value renders as
  "not stated" and is never filled with a default or an inference.
- **Inferences are marked.** Anything the extractor read rather than was told (e.g. "halfway" -> 50) goes
  into `inferred_fields` and renders with an `inferred` tag. Assumed schedule times and durations render
  with `assumed time` / `assumed length`.
- **It asks rather than invents.** When the extractor cannot find a field it needs, it returns
  `needs_clarification` with a specific question, shown at the top of the preview.
- **Priority is explainable.** `blockers.priority_reason` is a sentence assembled from the facts that moved
  the score (`buildEscalation` in `src/lib/escalation.ts`), rendered verbatim in the inbox.
- **The model never issues SQL and never writes.** It returns an object; `src/lib/actions.ts` validates it
  with Zod and performs every write.
- **Every state change is audited in the same transaction.** `audit()` is called inside the `tx()` that
  makes the change, so the trail cannot have gaps that look like completeness.
- **No hard deletes.** Discarding a schedule block is a status change.
- **Placement is deterministic.** Text parsing only proposes candidate times; `src/lib/schedule/plan.ts`
  places blocks and detects overlaps with `areIntervalsOverlapping`. Conflicts are reported with both
  activities named and both blocks kept - the system never chooses on the user's behalf.

---

## Connecting a model later

Implement `callModel()` in `src/lib/ai/llm.ts`, set `CHIEFOS_AI_PROVIDER=llm`, and restart. Nothing else
in the codebase imports a model or knows a provider name; the provider chip in the top bar updates by
itself. The contract the model must honour is written at the top of that file, and `extractionSchema` in
`src/lib/ai/types.ts` is the single source of truth for it (`zod-to-json-schema` turns it into a
structured-output spec).

---

## Architecture notes

- **Next.js App Router + TypeScript.** Every page is `dynamic = 'force-dynamic'`: the whole app reads the
  database per request, so there is nothing to prerender. `cacheComponents` is deliberately off.
- **`node:sqlite`**, built into Node - no native compilation, no `node-gyp` failure mode. All SQL lives in
  `src/lib/db/` (`core.ts` for access, `queries.ts` for reads, `schema.sql` for the eleven tables), which
  is what keeps a swap to another store a contained change.
- **Server-only data access.** `@/lib/db` is guarded with `server-only`; a client component importing it
  fails the build. Rows are rehydrated into plain objects at the boundary, because `node:sqlite` returns
  null-prototype rows that React refuses to pass to client components.
- **Zod** validates the extractor output, the submitted form and the future model response with one schema.
- **No charts, no auth library, no state library, no LLM orchestration framework.** See the dependency
  policy in the product doc.

---

## Demo script (four minutes, seven beats)

1. **Command Center.** Open with the guardrail, not the feature: "nothing in this system sends a message
   or closes a blocker without a human pressing approve." Then: these numbers are computed from records.
2. **Employee submits.** Switch to Aanya Sharma, click **Blocked on Finance (scripted)**, press **Check
   what this says**, then *edit a field in front of the room* before submitting.
3. **The clarification moment.** Click **Deliberately vague**, check it, and let the system ask its
   question instead of inventing a deadline. Pause here. Do not talk over it.
4. **CEO inbox.** Switch to Rohan Mehta, open `/decisions`. The blocker is at the top with the original
   wording and the priority reason. Edit the draft, approve and send.
5. **Employee acknowledges.** Switch back to Aanya, acknowledge - then point out the blocker is still open.
6. **Plan tomorrow.** `/schedule`, **Load sample priorities**, propose. The overlap warning fires naming
   both activities. Fix one block, approve, navigate away and back to show it persisted.
7. **Close.** `/activity` for the trail, then the provider chip: "extraction is rule-based today; that
   socket is where our approved internal model would go, and it is the one thing I am asking for."

### Before presenting

- `npm run build && npm start`, started before walking in.
- Press **Reset demo data** immediately before presenting so counts match rehearsal.
- Close everything else; disable notifications and auto-updates.
- Test with wi-fi off - everything except optional voice capture works offline.
- Have the fallback recording queued in a second window, muted.

### Still to do (human work, not code)

- **Record the fallback tape.** Four minutes of screen recording with narration. Every demo that fails,
  fails without one.
- **Rehearse aloud five times, timed.** Target under 4:30 without reading notes.
- **Line up an internal sponsor** and demo privately to them first.

---

All people, projects, updates and decisions in this repository are fictional. No real company record has
ever been in this system, and none should be before server-enforced authentication, authorisation and an
approved data classification are in place.
