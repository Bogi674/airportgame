/** Right edge of the build flyout beside the left rail, in CSS pixels: its left of 76 plus its width of 296 (theme.css, T36). */
export const FLYOUT_RIGHT_PX = 372;
/** Width the minimap takes at the bottom right: 12 px margin, 200 px map, 12 px padding and the border (Minimap.tsx). */
const MINIMAP_PX = 226;
/** Gap kept between a bottom panel and its neighbours. */
const GAP_PX = 16;

/**
 * Horizontal placement of a bottom panel (context bar, overlay legend): centred in the free band between the left edge,
 * or the build flyout while it is open, and the minimap, and no wider than that band, so none of them meet (T36).
 */
export function bottomCenter(flyoutOpen: boolean, maxPx: number): string {
  const left = (flyoutOpen ? FLYOUT_RIGHT_PX : 0) + GAP_PX;
  const right = MINIMAP_PX + GAP_PX;
  return `left:calc((100vw + ${left - right}px) / 2);transform:translateX(-50%);max-width:min(${maxPx}px, calc(100vw - ${left + right}px))`;
}
