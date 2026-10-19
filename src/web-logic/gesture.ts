export type SwipeAxis = "none" | "x" | "y";
export type TodoSwipe = "none" | "done" | "delete";

/** Direction while the finger is still down. Small moves stay none. */
export function dragAxis(dx: number, dy: number, blocked = false): SwipeAxis {
  if (blocked) {
    return "none";
  }
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (ax < 10 && ay < 10) {
    return "none";
  }
  if (ax > ay * 1.35) {
    return "x";
  }
  if (ay > ax * 1.35) {
    return "y";
  }
  return "none";
}

/** Commit a page or list gesture only when the move is clearly one axis. */
export function swipeAxis(dx: number, dy: number, blocked = false): SwipeAxis {
  if (blocked) {
    return "none";
  }
  const axis = dragAxis(dx, dy);
  if (axis === "x" && Math.abs(dx) >= 48) {
    return "x";
  }
  if (axis === "y" && Math.abs(dy) >= 64) {
    return "y";
  }
  return "none";
}

export function todoSwipeAction(dx: number): TodoSwipe {
  if (dx >= 88) {
    return "done";
  }
  if (dx <= -88) {
    return "delete";
  }
  return "none";
}

const PAGE_EDGE_PX = 28;

/**
 * Page swipe loses to inputs, mail-style rows, and the calendar surface.
 * A finger that starts on the screen edge may still change pages.
 */
export function allowPageDrag(target: Element, clientX: number, viewportWidth: number): boolean {
  if (target.closest("input, textarea, select, [data-no-swipe]")) {
    return false;
  }
  const calendar = target.closest("[data-gesture='calendar']");
  if (!calendar) {
    return true;
  }
  const width = viewportWidth > 0 ? viewportWidth : 0;
  return clientX <= PAGE_EDGE_PX || clientX >= width - PAGE_EDGE_PX;
}
