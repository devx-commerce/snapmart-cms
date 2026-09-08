# Audit logs — what Payload gives you, and what it doesn't

Question: *does Payload record which user changed which field, natively? If not, what can we
add?*

**Short answer: no, not natively — and the gap is specifically "who".** Payload's versions
record *what the document looked like* and *when*, with no actor at all. An official Audit
Logs feature exists but is part of the paid **Enterprise** tier.

Below: what was verified, the three options, and a working implementation on the
`spike/audit-logs` branch.

---

## What Payload actually gives you for free

### Versions — a full snapshot per save, with no author

Enabling `versions: { drafts: true }` (already on in this POC) stores a complete copy of the
document at every save, with a diff view in the admin panel. That is genuinely useful and
covers "what did this page look like last Tuesday" and "restore the previous version".

It does **not** cover "who". Verified directly against the running schema:

```
$ \d _product_content_v

 id | parent_id | version_medusa_product_id | version_marketing_name
 version_short_description | version_hero_image_id | version_updated_at
 version_created_at | version__status | created_at | updated_at
 latest | autosave | version_content_template_id | version_meta_* …
```

There is **no `created_by`, no `author`, no `user_id`** — not on that table and not on any
version table. And it is not a setting we missed: the entire versions config surface is

```ts
{ drafts?: boolean | IncomingDrafts; maxPerDoc?: number }
```

with zero occurrences of `author`, `createdBy` or `user` anywhere in the versions types.

Versions also cannot answer:

- **hard deletes** — when a document is deleted its versions go with it
- **who published** as distinct from who drafted
- **failed or unauthorised attempts**
- **reads**, which some compliance regimes require

### Everything else built in

`payload-locked-documents` tracks which document is currently open for editing. It is a
concurrency feature, not a history — the row disappears when the lock releases.

---

## The three options

| | Official Enterprise | Community plugin | Build it (~200 lines) |
|---|---|---|---|
| Who changed it | ✅ | ⚠️ one of them | ✅ |
| Field-level diff | ✅ | ⚠️ one of them, noisy | ✅ |
| Immutable | ✅ | ❌ neither | ✅ |
| Supported | Payload | one maintainer each | us |
| Cost | paid licence | free | ~a day |

### The community plugins, actually inspected

Not judged on their READMEs — installed and read.

**`payload-auditor`** (v2.0.2, 47 days old, 425/week, zero deps) — the best maintained of
them. Its log collection is:

```ts
fields: [ operation, identifier, scope, userAgent, hook, createdAt ]
```

**There is no user field, no document id and no diff.** `identifier` is the collection slug,
not the actor. It records "an update happened on `product-content` via `afterChange`, from
this user agent" — which does not answer your question. It has a `customLogger` escape hatch,
but using it means writing the diff and the actor capture yourself, at which point the plugin
is doing very little.

**`@rumess/payload-audit-log`** (v1.1.0, **381 days** since last publish, 209/week) — this
one has the right shape: `changes`, `documentId`, and `user: req.user?.id`. Its diff is

```js
Object.keys(doc).reduce((acc, key) =>
  JSON.stringify(doc[key]) !== JSON.stringify(previousDoc[key]) ? … : acc)
```

which is the naive version, and it has the flaw described below. Combined with a year of no
releases against a framework now on 3.88, it is a reference implementation rather than a
dependency.

**Neither plugin makes its log immutable** — both create an ordinary collection an admin can
edit or delete through the panel.

---

## The implementation (branch `spike/audit-logs`)

`src/collections/AuditLog.ts` + `src/hooks/auditLog.ts`, attached to all five content
collections. Three properties make it an audit log rather than a change feed.

### 1. It is immutable

```ts
access: {
  read:   authenticated,   // tighten to specific roles before production
  create: () => false,
  update: () => false,
  delete: () => false,
}
```

Entries are written by the hook with `overrideAccess: true`, which is the only path in.
Verified — as the admin account:

```
read            → HTTP 200
update          → HTTP 403 (denied)
delete          → HTTP 403 (denied)
create          → HTTP 403 (denied)   ← cannot forge an entry either
anonymous read  → HTTP 403 (denied)
```

An audit trail an administrator can quietly edit is not evidence of anything, and this is the
property both community plugins lack.

### 2. It denormalises the actor

`userEmail` is copied in at write time alongside the `user` relationship. Deleting a user
therefore does not erase who made past changes — the relationship goes null, the email stays.

### 3. It records the field-level diff, accurately

```
who   : admin@snapmart.local
what  : update product-content/8 — Landers Extra Virgin Olive Oil 500ml
fields: marketingName, shortDescription
   marketingName    : "Landers Signature Cold Brew 1L (New Recipe)" → "Landers Extra Virgin Olive Oil 500ml"
   shortDescription : "Now with 20% more caffeine." → "First cold pressing, single origin."
context: {"ip":"::1","status":"published","userAgent":"curl/8.7.1"}
```

Attribution follows the account — the same edit made with the BFF service key records
`bff@snapmart.local`. Deletes capture the last known state, since the version history goes
with the document.

---

## The finding that matters: a naive diff is unusable

The first version of this hook reported a change nobody made:

```
fields: marketingName, shortDescription, contentTemplate
   contentTemplate: 3 → "[2366 bytes — see version history]"
```

on an update that touched two text fields.

**Cause:** `doc` and `previousDoc` do not hydrate relationships to the same depth. After the
write, `doc.contentTemplate` is the fully populated template object while
`previousDoc.contentTemplate` is still the id `3`. Compared raw, every save that touches a
document with relationships reports phantom changes.

This matters more than it looks. **Once editors see changes they know they did not make, they
stop trusting the trail** — and an audit log nobody trusts is worse than none, because it is
still cited in incident reviews.

Fixed by normalising populated relationships back to ids before comparing. Both community
plugins compare raw and so have this flaw.

Two related decisions in the same hook:

- **Autosave is excluded.** It fires every 375 ms while an editor types; logging each one
  buries deliberate saves under keystroke-level rows.
- **A no-op save writes nothing.** Verified: re-saving an identical value produces no entry.
- **Large values are summarised**, not stored. A blocks array or Lexical tree becomes
  `[4 item(s), 2366 bytes — see version history]`. The full before/after is already
  recoverable from Payload's versions, which is exactly what versions are good at; copying it
  into the audit log would make the log a second database.

---

## ⚠️ Incident: auto-attaching to `users` made login take 5 minutes

Found by breaking it, so it is worth recording rather than quietly fixing.

The plugin attaches to every collection by default (opt-out, so a new collection is never
silently unaudited). Applied to `users`, that is a trap:

```
POST /api/users/login   200 in     15.8s
PATCH /api/users/1      200 in   3.0min
POST /api/users/login   200 in   5.0min      ← was ~50ms
```

**Cause.** A successful login writes to the user's `sessions` array. That is an update, so
`afterChange` fires, so the audit hook writes an audit row — inside the login's own database
transaction. Every login pays for an extra insert against a collection with a foreign key
back to the row being updated.

**Immediate fix:** `exclude: ['users']`. Login returned to ~60ms.

**Proper fix, not yet done.** Excluding `users` gives up exactly the thing worth auditing —
role changes. What is actually needed is a per-collection field allowlist, so `users` audits
`role` and `email` and ignores `sessions`, which is machine-written bookkeeping rather than
a change a person made.

**The general lesson for any audit log on this platform:** some fields are written by the
system on every request. Auditing them turns a read path into a write path. Before enabling
auditing on a collection, ask what the framework itself writes to it.

## Diff granularity and storage

Two problems found by using it, both fixed.

### Editing one field reported the whole blocks array

The first diff compared **top-level fields only**. `layout` is one field, so changing a
single `subheading` inside one block reported the entire array on both sides — two 40-line
JSON dumps with one line different between them. Seen on a real entry:

```
"layout": { "to": [ …both blocks in full… ], "from": [ …both blocks in full… ] }
```

`./diff.ts` now walks into arrays and objects and reports leaf paths:

```
layout.0.subheading: "it is only a starting point." → "ONLY THIS FIELD CHANGED"

changes size: 94 bytes   (was 926)
```

Three details that make it hold up on real documents:

- **Block rows are matched by `id`, not index.** Inserting a block at the top would
  otherwise renumber every row after it and report the whole array as rewritten. Adds,
  removes and reorders are reported as such (`[added …]`, `[removed …]`, `[order]`).
- **Lexical rich text is compared as its rendered plain text.** Its JSON is a deep tree of
  nodes and formatting state; a node-level diff is accurate and unreadable. An auditor needs
  "the paragraph now says X instead of Y".
- **Recursion is depth-capped** at 6, so a pathological structure reports as one changed
  path rather than being walked forever.

### Storage — the initial content load is the worst case

Measured per operation:

| Operation | avg `changes` JSON | why |
|---|---|---|
| **update** | **98 bytes** | only the leaves that changed |
| **create** | **389 bytes** | field *names* only, no values |
| **delete** | 883 bytes | values kept deliberately |

Three decisions behind those numbers:

1. **A create records which fields were populated, not their values.** Storing the values
   would make every audit row a second copy of the document it describes — and creates are
   the bulk of the volume during an initial load or the Magento content import. Nothing is
   lost: the document exists, and its first version holds exactly those values.

2. **A delete keeps values.** It is the one case where the data is otherwise gone — the
   document and its version history both disappear. Long values are truncated to 120
   characters with the original length noted.

3. **Bulk operations can opt out entirely** with `context: { skipAudit: true }`:

   ```ts
   payload.create({ …, context: { skipAudit: true } })
   ```

   The seed script uses it. Thousands of rows recording "the importer created everything" is
   storage spent on something one line in a runbook already says. Use it for the Magento
   import and record the migration itself instead.

Autosave is also excluded — it fires every 375 ms while an editor types.

**Still to decide: retention.** Entries accumulate forever. Payload's Jobs system can prune
on a schedule, but the retention period is a compliance decision, not a technical one —
deleting audit history has its own implications. Decide the period first.

## Recommendation

**Build it, and keep versions on.** They are complementary, not alternatives:

| Question | Answered by |
|---|---|
| Who changed the returns policy, and to what? | audit log |
| What exactly did this page look like on 3 September? | versions |
| Restore the previous version | versions |
| Who deleted this document? | audit log (versions are gone with it) |
| Which of my six admin roles is making most changes? | audit log |

Reasons to build rather than buy or install:

1. **Neither community plugin is immutable**, which is the property that makes it an audit
   log. Adding immutability to a plugin's collection means overriding its access control —
   at which point you own it anyway.
2. **Both diff naively**, so both produce the false positives above.
3. The whole thing is ~200 lines against a hook API this POC already uses twice.
4. The SoW names **six RBAC-governed admin roles** including two-person approval for price
   overrides. That is a compliance posture, and compliance evidence should not depend on a
   package with one maintainer and 209 weekly downloads.

**Consider Enterprise if** the requirement is formal — an external auditor, a retention
policy, or read-logging. Worth a pricing conversation before committing to the DIY route,
since it is Payload's supported answer and covers cases this does not.

---

## Not built, and worth scoping

- **Login / logout / failed-login events.** Payload has `afterLogin`, `afterLogout` and
  `afterForgotPassword` hooks on auth collections; wiring them into the same collection is
  small. Most compliance regimes ask for authentication events, not just content changes.
- **Retention.** Entries accumulate forever. Payload's Jobs system can prune on a schedule —
  but decide the retention period first, since deleting audit history has its own compliance
  implications.
- **Role-scoped read.** Currently any authenticated user can read the trail. It should be
  restricted to specific roles — an audit log is itself an information-disclosure surface
  (it contains old values of every field).
- **Field-level redaction.** Nothing in this content model is sensitive. If a future
  collection holds anything that is, the diff must exclude it — an audit log that records
  secrets in `from`/`to` has turned into a secrets store.
- **Export.** Auditors ask for CSV. `@payloadcms/plugin-import-export` would cover it.

---

## Reproducing

```bash
git checkout spike/audit-logs
pnpm dev
node scripts/demo-audit-log.mjs
```

Raw output: [`artifacts/08-audit-log.txt`](artifacts/08-audit-log.txt) and
[`artifacts/08-audit-log-immutability.txt`](artifacts/08-audit-log-immutability.txt).
