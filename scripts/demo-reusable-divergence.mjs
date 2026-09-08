/**
 * Phase 2 demo, part 2: copy-on-write.
 *
 * product-content/3 had "Stay in sync with the source" unticked in the admin panel, which
 * made ContentManager replay the source's blocks into a local copy. Editing the source
 * should now move the two live-linked consumers and leave the diverged one alone.
 *
 * Run: node scripts/demo-reusable-divergence.mjs
 */
const API = process.env.API ?? 'http://localhost:3000/api'

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

const get = async (p) => (await fetch(`${API}${p}`)).json()

const sharedCta = (blocks = []) => {
  const rc = blocks.find((b) => b.blockType === 'reusableContent')
  if (!rc) return ['—', '—']
  const resolved = rc.useSourceValues ? rc.source?.content : rc.content
  return [
    rc.useSourceValues ? 'live-linked' : 'local copy ',
    (resolved ?? []).find((b) => b.blockType === 'cta')?.heading ?? '(none)',
  ]
}

const snapshot = async (label) => {
  const [pages, products] = await Promise.all([
    get('/pages?depth=2'),
    get('/product-content?depth=2&sort=medusaProductId'),
  ])
  console.log(`\n--- ${label} ---`)
  const rows = [
    ...pages.docs.map((d) => [`pages/${d.slug}`, d.layout]),
    ...products.docs.map((d) => [`product/${d.medusaProductId}`, d.productDetail]),
  ]
  for (const [name, blocks] of rows) {
    const [mode, heading] = sharedCta(blocks)
    console.log(`  ${name.padEnd(32)} ${mode}  "${heading}"`)
  }
}

const token = await login()
await snapshot('BEFORE — product 3 has diverged, the other two still track the source')

const source = (await get('/reusable-content?depth=0')).docs[0]
await fetch(`${API}/reusable-content/${source.id}`, {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json', Authorization: `JWT ${token}` },
  body: JSON.stringify({
    content: source.content.map((b) =>
      b.blockType === 'cta' ? { ...b, heading: 'THIRD EDIT — only live-linked consumers move' } : b,
    ),
  }),
})
console.log(`\n>>> edited reusable-content/${source.id} again`)

await snapshot('AFTER — two followed, the diverged one held its own copy')
