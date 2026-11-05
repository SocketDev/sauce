export interface GlyphPart {
  readonly paths: readonly string[]
  // Shapes subtracted from THIS part, via a mask rather than an even-odd
  // subpath. Even-odd cannot express this. A cutout appended to a path that
  // already has interior subpaths lands on a different parity over each of
  // them, so it fills in some regions and subtracts in others. The package box
  // has three interior faces and showed exactly that. A mask is unconditional.
  readonly cutouts?: readonly string[] | undefined
  // Placement for this part's cutouts, when they are borrowed artwork drawn in
  // some other coordinate space.
  readonly cutoutTransform?: string | undefined
  // Winding rule. Glyphs default to even-odd so an internal cutout subtracts.
  // Traced artwork needs nonzero: its holes were authored against that rule,
  // and even-odd turns every self-overlap into a hole it never had.
  readonly fillRule?: 'evenodd' | 'nonzero' | undefined
  // An SVG transform applied to this part only, e.g. 'translate(11 11) scale(.5)'.
  readonly transform?: string | undefined
}

export interface RepoGlyph {
  // Accessible name for the composed logomark, e.g. 'Socket action'.
  readonly label: string
  // Placed pieces, filled white by the builder. Authored in `viewBox`.
  readonly parts: readonly GlyphPart[]
  // The square viewBox the parts are authored in.
  readonly viewBox: string
  // Where the mark comes from, so a later reader can re-derive it.
  readonly source: string
}
