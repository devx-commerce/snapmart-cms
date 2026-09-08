/**
 * Field-level diffing, down to the individual field inside a block.
 *
 * The naive version compares top-level fields only. On a blocks field that is useless:
 * editing one heading reports the entire `layout` array as changed, so the reader has to
 * eyeball two 40-line JSON dumps to find the one line that differs. Observed on audit-log
 * entry 20 — a single `subheading` edit produced a full before/after of both blocks.
 *
 * This walks into arrays and objects and reports leaf paths instead:
 *
 *     layout.0.subheading  "Replace this — it is only a starting point." → "it is only…"
 *     _status              "published" → "draft"
 *
 * Three things make it behave on real Payload documents:
 *
 *   Block rows are matched by `id`, not by index. Inserting a block at the top would
 *   otherwise renumber every row after it and report the whole array as rewritten.
 *
 *   Lexical rich text is compared as its rendered plain text. Its JSON is a deep tree of
 *   nodes with formatting state; a node-level diff is technically accurate and unreadable.
 *   What an auditor needs is "the paragraph now says X instead of Y".
 *
 *   Recursion is depth-capped. Below the cap a subtree is reported as a single changed
 *   path rather than being walked further.
 */

export type Diff = Record<string, { from: unknown; to: unknown }>

const MAX_DEPTH = 6
const MAX_STRING = 120

type Obj = Record<string, unknown>

const isObj = (v: unknown): v is Obj => Boolean(v) && typeof v === 'object' && !Array.isArray(v)

/** A Lexical editor value. */
const isLexical = (v: unknown): boolean => isObj(v) && isObj(v.root) && 'children' in v.root

/** Flatten a Lexical tree to the text a reader would see. */
export const lexicalText = (v: unknown): string => {
  const out: string[] = []
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(walk)
      return
    }
    if (!isObj(node)) return
    if (typeof node.text === 'string') out.push(node.text)
    if (Array.isArray(node.children)) node.children.forEach(walk)
  }
  walk(isObj(v) ? v.root : v)
  return out.join(' ').trim()
}

/**
 * Populated relationships arrive hydrated on one side and as a bare id on the other, which
 * would report a change nobody made. Reduce both to the id before comparing.
 */
const relationshipId = (v: unknown): unknown =>
  isObj(v) && 'id' in v && ('createdAt' in v || 'updatedAt' in v) ? v.id : v

const truncate = (v: unknown): unknown => {
  if (typeof v === 'string' && v.length > MAX_STRING) {
    return `${v.slice(0, MAX_STRING)}… (${v.length} chars)`
  }
  return v
}

/** A leaf we should record rather than walk into. */
const isLeaf = (v: unknown): boolean =>
  v === null || v === undefined || typeof v !== 'object' || isLexical(v)

const normaliseLeaf = (v: unknown): unknown => (isLexical(v) ? lexicalText(v) : truncate(v))

const rowId = (v: unknown): string | undefined =>
  isObj(v) && typeof v.id === 'string' ? v.id : undefined

const join = (path: string, key: string | number): string => (path ? `${path}.${key}` : String(key))

/**
 * Compare two values and write every differing leaf path into `out`.
 */
export const diffValues = (
  path: string,
  from: unknown,
  to: unknown,
  out: Diff,
  depth = 0,
  skip: (key: string) => boolean = () => false,
): void => {
  const a = relationshipId(from)
  const b = relationshipId(to)

  if (isLeaf(a) || isLeaf(b) || depth >= MAX_DEPTH) {
    const av = normaliseLeaf(a)
    const bv = normaliseLeaf(b)
    if (JSON.stringify(av) !== JSON.stringify(bv)) out[path] = { from: av ?? null, to: bv ?? null }
    return
  }

  if (Array.isArray(a) && Array.isArray(b)) {
    // Block and array rows carry stable ids. Matching on them means an insert or a reorder
    // reports as such, instead of as every subsequent row having been rewritten.
    const aIds = a.map(rowId)
    const bIds = b.map(rowId)
    const byId = aIds.every(Boolean) && bIds.every(Boolean)

    if (byId) {
      const aMap = new Map(a.map((row) => [rowId(row) as string, row]))
      const bMap = new Map(b.map((row) => [rowId(row) as string, row]))

      for (const [id, row] of aMap) {
        if (!bMap.has(id)) out[join(path, `[removed ${id}]`)] = { from: summarise(row), to: null }
      }
      for (const [id, row] of bMap) {
        if (!aMap.has(id)) out[join(path, `[added ${id}]`)] = { from: null, to: summarise(row) }
      }
      // Report position changes separately from content changes.
      const aOrder = aIds.filter((id) => id && bMap.has(id))
      const bOrder = bIds.filter((id) => id && aMap.has(id))
      if (JSON.stringify(aOrder) !== JSON.stringify(bOrder)) {
        out[join(path, '[order]')] = { from: aOrder, to: bOrder }
      }
      for (const [id, bRow] of bMap) {
        const aRow = aMap.get(id)
        if (aRow) diffValues(join(path, bIds.indexOf(id)), aRow, bRow, out, depth + 1, skip)
      }
      return
    }

    // No stable ids — fall back to positional comparison.
    const len = Math.max(a.length, b.length)
    for (let i = 0; i < len; i++) diffValues(join(path, i), a[i], b[i], out, depth + 1, skip)
    return
  }

  if (isObj(a) && isObj(b)) {
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (skip(key)) continue
      diffValues(join(path, key), a[key], b[key], out, depth + 1, skip)
    }
    return
  }

  // Different shapes entirely.
  if (JSON.stringify(a) !== JSON.stringify(b)) out[path] = { from: summarise(a), to: summarise(b) }
}

/** Compact representation of a whole subtree, for added/removed rows. */
export const summarise = (value: unknown): unknown => {
  if (isLexical(value)) return lexicalText(value)
  if (isObj(value) && typeof value.blockType === 'string') {
    const label = value.heading ?? value.title ?? value.label ?? lexicalText(value.content)
    return label ? `${value.blockType}: ${String(label).slice(0, 120)}` : String(value.blockType)
  }
  const json = JSON.stringify(value)
  if (json && json.length > 240) return `[${json.length} bytes — see version history]`
  return value ?? null
}

/** Flatten a created or deleted document into leaf paths. */
export const flatten = (
  value: unknown,
  path = '',
  out: Diff = {},
  direction: 'to' | 'from' = 'to',
  depth = 0,
  skip: (key: string) => boolean = () => false,
): Diff => {
  if (isLeaf(value) || depth >= MAX_DEPTH) {
    if (path) {
      const v = normaliseLeaf(value)
      out[path] = direction === 'to' ? { from: null, to: v ?? null } : { from: v ?? null, to: null }
    }
    return out
  }
  if (Array.isArray(value)) {
    value.forEach((item, i) => {
      flatten(item, join(path, i), out, direction, depth + 1, skip)
    })
    return out
  }
  if (isObj(value)) {
    for (const [k, v] of Object.entries(value)) {
      if (skip(k)) continue
      flatten(v, join(path, k), out, direction, depth + 1, skip)
    }
  }
  return out
}
