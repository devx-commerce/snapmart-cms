import type { CollectionBeforeValidateHook } from 'payload'
import { APIError } from 'payload'

/**
 * Enforces the one hard rule snapmart-frontend/docs/glossary.md states outright:
 *
 *   "Never render a price that came from Payload. Payload may hold a Medusa product ID;
 *    it must not hold the product's name, price, or stock."
 *
 * Medusa is the source of truth for price, stock and the canonical product name. Payload
 * holds editorial enrichment keyed by `medusaProductId` and nothing else. A field named
 * `price` arriving here means someone is about to make the content system authoritative
 * for money, so this rejects the write rather than storing it.
 *
 * Note the collection deliberately calls its own field `marketingName`, never `name` --
 * the SoW gives Payload the *marketing* name (p.114) while the canonical name stays
 * Medusa's. Two different things that would otherwise share one word.
 */
const FORBIDDEN = [
  'price',
  'prices',
  'salePrice',
  'currency',
  'stock',
  'stockLevel',
  'inventory',
  'inventoryQuantity',
  'quantity',
  'productName',
  'name',
]

export const rejectCommerceFields: CollectionBeforeValidateHook = ({ data }) => {
  if (!data) return data

  const offending = Object.keys(data).filter((key) => FORBIDDEN.includes(key))

  if (offending.length > 0) {
    throw new APIError(
      `Commerce data must not be stored in Payload. Medusa owns these fields: ${offending.join(
        ', ',
      )}. Payload holds editorial content keyed by medusaProductId only.`,
      400,
    )
  }

  return data
}
