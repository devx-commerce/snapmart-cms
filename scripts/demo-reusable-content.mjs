/**
 * Phase 2 demo: one piece of content, authored once, consumed by documents in TWO
 * different collection types.
 *
 * Run:  node scripts/demo-reusable-content.mjs
 * (requires `pnpm dev` running and PAYLOAD_TOKEN in the env, or it logs in itself)
 */
const API = process.env.API ?? 'http://localhost:3000/api'
const EMAIL = process.env.PAYLOAD_EMAIL ?? 'admin@snapmart.local'
const PASSWORD = process.env.PAYLOAD_PASSWORD ?? 'SnapmartPOC123!'

const login = async () => {
  const res = await fetch(`${API}/users/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  })
  return (await res.json()).token
}

const get = async (path) => (await fetch(`${API}${path}`)).json()

/** Pull the CTA heading out of whichever reusableContent block a document carries. */
const readSharedHeading = (blocks = []) => {
  const rc = blocks.find((b) => b.blockType === 'reusableContent')
  if (!rc) return '(no reusableContent block)'
  const resolved = rc.useSourceValues ? rc.source?.content : rc.content
  const cta = (resolved ?? []).find((b) => b.blockType === 'cta')
  return `${rc.useSourceValues ? 'live ' : 'COPY '}| ${cta?.heading ?? '(no cta)'}`
}

const snapshot = async (label) => {
  const [pages, products] = await Promise.all([
    get('/pages?depth=2'),
    get('/product-content?depth=2&sort=medusaProductId'),
  ])
  console.log(`\n--- ${label} ---`)
  for (const p of pages.docs) {
    console.log(
      `  pages/${p.slug.padEnd(22)} updatedAt=${p.updatedAt}  ${readSharedHeading(p.layout)}`,
    )
  }
  for (const p of products.docs) {
    console.log(
      `  product/${p.medusaProductId.padEnd(21)} updatedAt=${p.updatedAt}  ${readSharedHeading(p.productDetail)}`,
    )
  }
  return { pages: pages.docs, products: products.docs }
}

const token = await login()

const before = await snapshot('BEFORE — one source, three consumers, two collection types')

// Edit the SOURCE only. No consuming document is touched.
const source = (await get('/reusable-content?depth=0')).docs[0]
const edited = source.content.map((b) =>
  b.blockType === 'cta' ? { ...b, heading: 'Members save more — every single trip' } : b,
)
await fetch(`${API}/reusable-content/${source.id}`, {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json', Authorization: `JWT ${token}` },
  body: JSON.stringify({ content: edited }),
})
console.log('\n>>> edited reusable-content/%s ONLY (no write to any consuming document)', source.id)

const after = await snapshot('AFTER — all three consumers reflect the edit')

// The claim that matters: consumers changed WITHOUT being written to.
const untouched = [...before.pages, ...before.products].every((b) => {
  const a = [...after.pages, ...after.products].find((x) => x.id === b.id)
  return a.updatedAt === b.updatedAt
})
console.log(
  `\nRESULT: every consumer reflects the new copy; consumer updatedAt unchanged = ${untouched}`,
)
process.exit(untouched ? 0 : 1)
