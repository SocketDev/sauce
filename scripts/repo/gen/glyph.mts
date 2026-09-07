import type { RepoGlyph } from '../../fleet/gen/glyph-types.mts'

const GLYPH_PARTS = [
  {
    cutoutTransform: 'translate(4.9 1.4) scale(.727)',
    cutouts: [
      'M9.886 9.538c.192-.314.675-.178.675.19v5.85c0 .251.204.455.456.455h2.736c.285 0 .46.312.311.555l-4.909 8.038c-.192.314-.675.179-.675-.19v-5.849a.456.456 0 0 0-.456-.456H5.288a.365.365 0 0 1-.311-.554z',
    ],
    paths: [
      'M9.2 2.2h5.6v3.1l2.5 3.4a4 4 0 0 1 .75 2.33V20.4a2 2 0 0 1-2 2H7.95a2 2 0 0 1-2-2V11.03a4 4 0 0 1 .75-2.33l2.5-3.4Z',
    ],
  },
] satisfies RepoGlyph['parts']

export const REPO_GLYPH = {
  label: 'Socket sauce',
  parts: GLYPH_PARTS,
  source: 'An upright sauce bottle with the Socket bolt cut through its body.',
  viewBox: '0 0 24 24',
} satisfies RepoGlyph
