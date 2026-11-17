/** Geometry-only helpers for fixed composer + latest-reply navigation. */
export interface VerticalRect { top: number; bottom: number }

/** Keep short comments fully visible; align long ones at the readable top edge. */
export function scrollDeltaForComment(
  rect: VerticalRect,
  visibleTop: number,
  visibleBottom: number,
): number {
  if (visibleBottom <= visibleTop) return 0;
  const room = visibleBottom - visibleTop;
  const height = rect.bottom - rect.top;
  const targetTop = height > room ? visibleTop : visibleBottom - height;
  return rect.top - targetTop;
}

export function isCommentInView(
  rect: VerticalRect,
  visibleTop: number,
  visibleBottom: number,
): boolean {
  return rect.bottom > visibleTop && rect.top < visibleBottom &&
    rect.bottom <= visibleBottom + 8;
}

/** VisualViewport excludes keyboards on browsers that leave the layout viewport fixed. */
export function keyboardLift(layoutHeight: number, visualBottom: number, isFocused: boolean): number {
  const overlap = Math.max(0, layoutHeight - visualBottom);
  return isFocused && overlap >= 110 ? overlap : 0;
}
