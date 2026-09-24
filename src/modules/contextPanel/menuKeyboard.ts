/**
 * Keyboard movement inside a floating menu.
 *
 * The reading-actions menu is a flat list of buttons interleaved with group
 * labels, so "the next row" is not "the next child". The panel collects the
 * focusable rows and asks this module which one the arrow keys should land on;
 * keeping that arithmetic here makes the wrap-around rules testable without a
 * document.
 */

/** Keys this module answers for. Anything else leaves focus alone. */
export type MenuFocusKey = "ArrowDown" | "ArrowUp" | "Home" | "End";

export function isMenuFocusKey(key: string): key is MenuFocusKey {
  return (
    key === "ArrowDown" || key === "ArrowUp" || key === "Home" || key === "End"
  );
}

/**
 * Index of the row a key press should focus.
 *
 * `currentIndex` is -1 when nothing inside the menu has focus yet, which is the
 * state right after the menu opens: Down then starts at the top and Up at the
 * bottom. Movement wraps, because a menu short enough to see whole is easier to
 * cycle than to bump against.
 *
 * Returns -1 when there is nothing to focus.
 */
export function resolveMenuFocusIndex(
  itemCount: number,
  currentIndex: number,
  key: MenuFocusKey,
): number {
  const count = Number.isFinite(itemCount) ? Math.floor(itemCount) : 0;
  if (count <= 0) return -1;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  const hasFocus =
    Number.isFinite(currentIndex) && currentIndex >= 0 && currentIndex < count;
  if (!hasFocus) return key === "ArrowDown" ? 0 : count - 1;
  const current = Math.floor(currentIndex);
  return key === "ArrowDown"
    ? (current + 1) % count
    : (current - 1 + count) % count;
}
