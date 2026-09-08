import type { DefaultTypedEditorState } from '@payloadcms/richtext-lexical'

/** Minimal valid Lexical value for a single paragraph. Keeps the seed readable. */
export const paragraph = (text: string): DefaultTypedEditorState =>
  ({
    root: {
      type: 'root',
      format: '',
      indent: 0,
      version: 1,
      direction: 'ltr',
      children: [
        {
          type: 'paragraph',
          format: '',
          indent: 0,
          version: 1,
          direction: 'ltr',
          textFormat: 0,
          textStyle: '',
          children: [
            { type: 'text', text, format: 0, style: '', mode: 'normal', detail: 0, version: 1 },
          ],
        },
      ],
    },
  }) as unknown as DefaultTypedEditorState
