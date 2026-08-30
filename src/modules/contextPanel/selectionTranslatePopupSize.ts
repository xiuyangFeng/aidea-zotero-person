export function getSelectionTranslateSingleLineHeight(params: {
  fontSize: number;
  lineHeight: number;
  paddingY?: number;
  borderWidth?: number;
}): number {
  const { fontSize, lineHeight, paddingY = 10, borderWidth = 1 } = params;
  const textLineHeight = Math.max(0, fontSize) * Math.max(0, lineHeight);
  return Math.ceil(
    textLineHeight + Math.max(0, paddingY) * 2 + Math.max(0, borderWidth) * 2,
  );
}

export function getSelectionTranslateContentHeight(params: {
  contentHeight: number;
  minimumHeight: number;
  heightCap: number;
}): number {
  const minimumHeight = Math.max(0, params.minimumHeight);
  const heightCap = Math.max(minimumHeight, params.heightCap);
  return Math.min(heightCap, Math.max(minimumHeight, params.contentHeight));
}

export function getSelectionTranslateDefaultHeightCap(params: {
  viewerHeight: number;
  minimumHeight: number;
}): number {
  const minimumHeight = Math.max(0, params.minimumHeight);
  return Math.max(
    minimumHeight,
    Math.min(320, Math.round(Math.max(0, params.viewerHeight) * 0.42)),
  );
}

export function resolveSelectionTranslateContentHeight(params: {
  contentHeight: number;
  viewerHeight: number;
  minimumHeight: number;
  rememberedHeight: number | null;
}): number {
  const heightCap =
    params.rememberedHeight === null
      ? getSelectionTranslateDefaultHeightCap(params)
      : Math.max(params.minimumHeight, params.rememberedHeight);
  return getSelectionTranslateContentHeight({
    contentHeight: params.contentHeight,
    minimumHeight: params.minimumHeight,
    heightCap,
  });
}

/**
 * Height ceiling for the bilingual source block.
 *
 * The source is reference material, not the answer, so it takes a fixed slice
 * of the viewer and scrolls past it rather than pushing the translation out of
 * sight. One complete line is the floor: a block too short to show its own
 * first line would read as broken. The remaining space is still policed by
 * `getSelectionTranslateAvailableResultHeight`, which measures the popup's
 * chrome — this block included — before capping the result box, so a tall
 * source cannot push the popup out of the reader.
 */
export function getSelectionTranslateSourceMaxHeight(params: {
  viewerHeight: number;
  minimumHeight: number;
  ratio?: number;
  cap?: number;
}): number {
  const minimumHeight = Math.max(0, params.minimumHeight);
  const ratio = Number.isFinite(params.ratio) ? Number(params.ratio) : 0.22;
  const cap = Number.isFinite(params.cap) ? Number(params.cap) : 180;
  return Math.max(
    minimumHeight,
    Math.min(
      Math.max(0, cap),
      Math.round(Math.max(0, params.viewerHeight) * Math.max(0, ratio)),
    ),
  );
}

export function getSelectionTranslateMeasuredHeight(params: {
  boundingHeight: number;
  offsetHeight: number;
  scrollHeight: number;
  minimumHeight: number;
}): number {
  return Math.max(
    Math.max(0, params.minimumHeight),
    Math.ceil(
      Math.max(params.boundingHeight, params.offsetHeight, params.scrollHeight),
    ),
  );
}

export function scheduleSelectionTranslateLayout<T>(params: {
  scheduleFrame: (callback: () => void) => void;
  readLayoutState: () => T;
  applyLayout: (state: T) => void;
}): void {
  // Read state inside the deferred callback so an older queued relayout cannot
  // replay the height that was current when it was scheduled.
  params.scheduleFrame(() => {
    params.applyLayout(params.readLayoutState());
  });
}
