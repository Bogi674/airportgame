/** Right edge of the left rail zone in CSS pixels: 10 px margin plus the 48 px rail and an 8 px gap (UI revision 6 section 4.1). */
export const RAIL_RIGHT_PX = 66;
/** Right edge of the build flyout beside the left rail: its left of 66 plus its width of 264. */
export const FLYOUT_RIGHT_PX = 330;
/** Width the minimap column takes at the bottom right: the 220 px map plus the 10 px margin. */
export const MINIMAP_PX = 230;
/** Gap kept between a bottom panel and its neighbours. */
const GAP_PX = 16;
/** Bottom of the panels that sit above the task bar: the 44 px task bar, its 10 px margin and a 10 px gap. */
export const ABOVE_TASKBAR_PX = 64;

/**
 * Horizontal placement of a bottom panel (context bar, overlay legend): centred in the free band between the rail,
 * or the build flyout while it is open, and the minimap column, and no wider than that band, so none of them meet.
 */
export function bottomCenter(flyoutOpen: boolean, maxPx: number): string {
  const left = (flyoutOpen ? FLYOUT_RIGHT_PX : RAIL_RIGHT_PX) + GAP_PX;
  const right = MINIMAP_PX + GAP_PX;
  return `left:calc((100vw + ${left - right}px) / 2);transform:translateX(-50%);max-width:min(${maxPx}px, calc(100vw - ${left + right}px))`;
}
