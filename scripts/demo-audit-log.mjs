/**
 * Audit log demo: who changed which field, when — and that nobody can rewrite it.
 *
 * Run: node scripts/demo-audit-log.mjs
 */
const API = process.env.API ?? 'http://localhost:3000/api'
const auth = (t) => ({ 'Content-Type': 'application/json', Authorization: `JWT ${t}` })

const login = async () =>
  (
    await (
      await fetch(`${API}/users/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: process.env.PAYLOAD_EMAIL ?? 'admin@snapmart.local',
          password: process.env.PAYLOAD_PASSWORD ?? 'SnapmartPOC123!',
        }),
      })
    ).json()
  ).token

const token = await login()
const latest = async () => {
  const res = await fetch(`${API}/audit-log?depth=0&limit=1&sort=-createdAt`, {
    headers: auth(token),
  })
  return (await res.json()).docs?.[0]
}
const show = (e) => {
  if (!e) return console.log('   (no entry — correctly suppressed)')
  console.log(`   who   : ${e.userEmail}`)
  console.log(`   what  : ${e.operation} ${e.collectionSlug}/${e.documentId} — ${e.documentLabel}`)
  console.log(`   fields: ${e.changedFields.join(', ') || '(none)'}`)
  for (const [f, c] of Object.entries(e.changes ?? {})) {
    console.log(`      ${f}: ${JSON.stringify(c.from)} → ${JSON.stringify(c.to)}`)
  }
}

const product = (await (await fetch(`${API}/product-content?depth=0&limit=1`)).json()).docs[0]
const before = await latest()

console.log('=== 1. change two text fields ===')
await fetch(`${API}/product-content/${product.id}`, {
  method: 'PATCH',
  headers: auth(token),
  body: JSON.stringify({ shortDescription: `Edited at ${new Date().toISOString()}` }),
})
await new Promise((r) => setTimeout(r, 1500))
show(await latest())

console.log('\n=== 2. save the SAME value again — no entry should be written ===')
const marker = await latest()
await fetch(`${API}/product-content/${product.id}`, {
  method: 'PATCH',
  headers: auth(token),
  body: JSON.stringify({ shortDescription: marker.changes.shortDescription.to }),
})
await new Promise((r) => setTimeout(r, 1500))
const after = await latest()
console.log(
  after.id === marker.id
    ? '   ✓ no new entry — a no-op save is not a change'
    : `   ✗ an entry was written for a no-op (id ${after.id})`,
)

console.log('\n=== 3. can an admin rewrite the trail? ===')
for (const [label, init] of [
  [
    'update',
    {
      method: 'PATCH',
      headers: auth(token),
      body: JSON.stringify({ userEmail: 'forged@evil.com' }),
    },
  ],
  ['delete', { method: 'DELETE', headers: auth(token) }],
]) {
  const res = await fetch(`${API}/audit-log/${marker.id}`, init)
  console.log(
    `   ${label.padEnd(7)} → HTTP ${res.status} ${res.status === 403 ? '(denied ✓)' : '(NOT DENIED ✗)'}`,
  )
}
const forge = await fetch(`${API}/audit-log`, {
  method: 'POST',
  headers: auth(token),
  body: JSON.stringify({
    operation: 'update',
    collectionSlug: 'pages',
    documentId: '1',
    userEmail: 'forged@evil.com',
  }),
})
console.log(
  `   create  → HTTP ${forge.status} ${forge.status === 403 ? '(denied ✓)' : '(NOT DENIED ✗)'}`,
)

const anon = await fetch(`${API}/audit-log`)
console.log(
  `   anonymous read → HTTP ${anon.status} ${anon.status === 403 ? '(denied ✓)' : '(NOT DENIED ✗)'}`,
)

console.log(`\nEntries before this run: ${before?.id ?? 0} · after: ${(await latest()).id}`)
