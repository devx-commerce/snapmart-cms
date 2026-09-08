'use client'

import { useConfig, useForm, useFormFields } from '@payloadcms/ui'
import type { UIFieldClientProps } from 'payload'
import { useEffect, useRef } from 'react'

/**
 * The copy-on-write mechanism behind the `reusableContent` block.
 *
 * Renders nothing. It watches the block's `useSourceValues` checkbox and:
 *
 *   unticked -- fetches the referenced reusable-content document and replays each of its
 *     blocks into this block's local `content` field, so the editor now owns an
 *     independent copy.
 *
 *   re-ticked -- removes those rows again, so rendering falls back to the live source.
 *
 * Field paths are derived from this field's own `path`, because a block's fields are
 * addressed relative to their row (`layout.0.contentManager` -> `layout.0.content`).
 * `schemaPath` is what tells Payload which block configs the target field accepts.
 *
 * Adapted from payloadcms/reusable-content-example. The upstream version switches on
 * blockType and hand-writes the sub-field state per block; this derives it from the
 * fetched document instead, so adding a block to the library needs no change here.
 */

type ReusableContentDoc = {
  content?: Array<Record<string, unknown> & { blockType: string }>
}

export const ContentManager: React.FC<UIFieldClientProps> = ({ path, schemaPath }) => {
  const isFetching = useRef(false)
  const {
    config: {
      serverURL,
      routes: { api },
    },
  } = useConfig()
  const { addFieldRow } = useForm()

  const checkboxPath = path.replace('contentManager', 'useSourceValues')
  const sourcePath = path.replace('contentManager', 'source')
  const contentPath = path.replace('contentManager', 'content')
  const contentSchemaPath = schemaPath ? schemaPath.replace('contentManager', 'content') : null

  const { checkboxValue, sourceValue, rowCount, dispatchField } = useFormFields(
    ([fields, dispatch]) => ({
      checkboxValue: fields[checkboxPath]?.value as boolean | undefined,
      sourceValue: fields[sourcePath]?.value as number | string | undefined,
      // A blocks field's own value is its row count.
      rowCount: fields[contentPath]?.value as number | undefined,
      dispatchField: dispatch,
    }),
  )

  useEffect(() => {
    if (!sourceValue) return

    // Back in sync -- drop the local copy so rendering resolves through to the source.
    if (checkboxValue && rowCount) {
      for (let i = rowCount - 1; i >= 0; i--) {
        dispatchField({ type: 'REMOVE_ROW', path: contentPath, rowIndex: i })
      }
      return
    }

    // Diverging -- take a one-time copy of the source's blocks.
    if (!checkboxValue && !rowCount && !isFetching.current && contentSchemaPath) {
      isFetching.current = true

      const copyFromSource = async () => {
        try {
          const base = serverURL ? `${serverURL}${api}` : api
          const res = await fetch(`${base}/reusable-content/${sourceValue}?depth=0`, {
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
          })
          const doc: ReusableContentDoc = await res.json()

          doc.content?.forEach((block, rowIndex) => {
            const { blockType, id: _id, ...fields } = block
            void _id

            addFieldRow({
              path: contentPath,
              schemaPath: contentSchemaPath,
              blockType,
              rowIndex,
              subFieldState: Object.fromEntries(
                Object.entries(fields).map(([key, value]) => [key, { value: value ?? null }]),
              ),
            })
          })
        } finally {
          isFetching.current = false
        }
      }

      void copyFromSource()
    }
  }, [
    checkboxValue,
    sourceValue,
    rowCount,
    contentPath,
    contentSchemaPath,
    dispatchField,
    addFieldRow,
    serverURL,
    api,
  ])

  return null
}
