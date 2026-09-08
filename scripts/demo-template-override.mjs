/**
 * Phase 3 demo, part 2:
 *   (a) the `extra` slot -- one product needs a section the shared layout does not provide
 *   (b) strategy A (copy-on-create) on `pages`, for contrast with strategy B on products
 *
 * Run: node scripts/demo-template-override.mjs
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

const get = async (p) => (await fetch(`${API}${p}`)).json()
const token = await login()

// ---------- (a) the extra slot ----------
const { docs: products } = await get('/product-content?depth=0&sort=medusaProductId')
const [coldBrew, oliveOil] = products

await fetch(`${API}/product-content/${oliveOil.id}`, {
  method: 'PATCH',
  headers: auth(token),
  body: JSON.stringify({
    templateOverrides: [
      {
        blockType: 'cta',
        heading: 'Harvest 2026 is here',
        body: 'This season’s pressing, only while stocks last.',
        label: 'See the harvest',
        href: '/olive-oil-harvest',
      },
    ],
  }),
})

console.log('=== (a) EXTRA SLOT — one product adds a section, the other does not ===\n')
for (const id of [coldBrew.id, oliveOil.id]) {
  const d = await get(`/product-content/${id}?depth=1`)
  console.log(`  ${d.medusaProductId}`)
  console.log(`    own blocks     : ${d.productDetail.length}`)
  console.log(`    extra sections : ${(d.templateOverrides ?? []).length}`)
  console.log(`    rendered       : ${d.resolvedDetail.map((b) => b.blockType).join(' → ')}\n`)
}

// ---------- (b) strategy A on pages ----------
console.log('=== (b) COPY-ON-CREATE — the template seeds a new page, then lets go ===\n')
const campaign = (await get('/page-templates?depth=0&where[strategy][equals]=copyOnCreate')).docs[0]

// Idempotent: this script is meant to be re-runnable, and `slug` is unique.
await fetch(`${API}/pages?where[slug][equals]=holiday-campaign`, {
  method: 'DELETE',
  headers: auth(token),
})

const created = await (
  await fetch(`${API}/pages`, {
    method: 'POST',
    headers: auth(token),
    body: JSON.stringify({
      title: 'Holiday Campaign',
      slug: 'holiday-campaign',
      contentTemplate: campaign.id,
      // No layout supplied. copyOnCreate fills it from the template; the `main` slot has
      // nothing to receive, so it collapses rather than leaving an empty section.
      _status: 'published',
    }),
  })
).json()

const page = created.doc ?? created
if (!page?.layout) {
  console.error('create failed:', JSON.stringify(created).slice(0, 400))
  process.exit(1)
}
console.log(
  `  template "${campaign.name}" layout : ${campaign.layout.map((b) => b.blockType).join(' → ')}`,
)
console.log(
  `  new page STORED layout           : ${page.layout.map((b) => b.blockType).join(' → ')}`,
)
console.log('  ^ the template blocks were WRITTEN INTO the page. It owns them now.\n')

// Edit the template; the page must NOT follow.
const headingBefore = page.layout.find((b) => b.blockType === 'hero')?.heading
await fetch(`${API}/page-templates/${campaign.id}`, {
  method: 'PATCH',
  headers: auth(token),
  body: JSON.stringify({
    layout: campaign.layout.map((b) =>
      b.blockType === 'hero' ? { ...b, heading: 'TEMPLATE EDITED AFTER THE FACT' } : b,
    ),
  }),
})
const reread = await get(`/pages/${page.id}?depth=0`)
const headingAfter = reread.layout.find((b) => b.blockType === 'hero')?.heading

console.log(`  page hero before template edit : "${headingBefore}"`)
console.log(`  page hero after  template edit : "${headingAfter}"`)
console.log(
  `\nRESULT: copy-on-create page ignored the template edit = ${headingBefore === headingAfter}`,
)
process.exit(headingBefore === headingAfter ? 0 : 1)
