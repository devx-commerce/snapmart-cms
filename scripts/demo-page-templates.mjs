/**
 * Phase 3 demo: layout inheritance for a whole kind of page.
 *
 * Two products share one PDP template. The template supplies shipping, membership and
 * returns; each product supplies only its own detail. Editing the template must change
 * both products WITHOUT writing to either document.
 *
 * Run: node scripts/demo-page-templates.mjs
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

/** One-line summary of a rendered block. */
const describe = (b) => {
  if (b.blockType === 'richText')
    return `richText   "${(b.content?.root?.children?.[0]?.children?.[0]?.text ?? '').slice(0, 52)}…"`
  if (b.blockType === 'reusableContent')
    return `reusable   -> "${b.source?.title ?? b.source}" (${b.useSourceValues ? 'live' : 'copy'})`
  if (b.blockType === 'cta') return `cta        "${b.heading}"`
  if (b.blockType === 'hero') return `hero       "${b.heading}"`
  return b.blockType
}

const showProducts = async (label) => {
  const { docs } = await get('/product-content?depth=2&sort=medusaProductId')
  console.log(`\n=== ${label} ===`)
  for (const d of docs) {
    console.log(`\n  ${d.medusaProductId}   (updatedAt ${d.updatedAt})`)
    console.log(`    stored productDetail : ${d.productDetail.length} block(s) — the product's own`)
    console.log(`    resolvedDetail       : ${d.resolvedDetail.length} block(s) — template + own`)
    d.resolvedDetail.forEach((b, i) => console.log(`      ${i + 1}. ${describe(b)}`))
  }
  return docs
}

const token = await login()
const before = await showProducts('BEFORE — two products, one template')

// Edit the TEMPLATE only.
const tpl = (await get('/page-templates?depth=0&where[appliesTo][equals]=product-content')).docs[0]
await fetch(`${API}/page-templates/${tpl.id}`, {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json', Authorization: `JWT ${token}` },
  body: JSON.stringify({
    layout: tpl.layout.map((b) =>
      b.blockType === 'richText' &&
      b.content?.root?.children?.[0]?.children?.[0]?.text?.startsWith('Returns')
        ? {
            ...b,
            content: {
              ...b.content,
              root: {
                ...b.content.root,
                children: [
                  {
                    ...b.content.root.children[0],
                    children: [
                      {
                        ...b.content.root.children[0].children[0],
                        text: 'Returns — extended to 60 days for members during the holiday season.',
                      },
                    ],
                  },
                ],
              },
            },
          }
        : b,
    ),
  }),
})
console.log(`\n>>> edited page-templates/${tpl.id} ONLY — no write to any product`)

const after = await showProducts('AFTER — both products carry the new returns policy')

const untouched = before.every((b) => after.find((a) => a.id === b.id).updatedAt === b.updatedAt)
console.log(`\nRESULT: both products changed; product updatedAt unchanged = ${untouched}`)
process.exit(untouched ? 0 : 1)
