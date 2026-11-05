// Copyright 2026 RuaKit contributors. SPDX-License-Identifier: MIT

function parentElement(element: Element): Element | null {
  if (element.assignedSlot) return element.assignedSlot;
  if (element.parentElement) return element.parentElement;
  const root = element.getRootNode();
  return "host" in root ? (root as ShadowRoot).host : null;
}

const clipsOverflow = /^(auto|scroll|hidden|clip)$/;

/** Clip the portalled outline to the target's rectangular overflow ancestors. */
export function cursorHighlightClip(
  target: HTMLElement,
  bounds: DOMRect,
): string | undefined {
  const view = target.ownerDocument.defaultView;
  if (!view) return undefined;

  // Include the outline's 3px spread shadow unless an ancestor clips it.
  let top = -3;
  let right = -3;
  let bottom = -3;
  let left = -3;
  for (
    let ancestor = parentElement(target);
    ancestor;
    ancestor = parentElement(ancestor)
  ) {
    const style = view.getComputedStyle(ancestor);
    const clipX = clipsOverflow.test(style.overflowX || style.overflow);
    const clipY = clipsOverflow.test(style.overflowY || style.overflow);
    if (!clipX && !clipY) continue;

    const rect = ancestor.getBoundingClientRect();
    // client dimensions exclude borders and scrollbars. Account for CSS scaling.
    const element = ancestor as HTMLElement;
    const scaleX = element.offsetWidth ? rect.width / element.offsetWidth : 1;
    const scaleY = element.offsetHeight
      ? rect.height / element.offsetHeight
      : 1;
    const clipLeft = rect.left + ancestor.clientLeft * scaleX;
    const clipTop = rect.top + ancestor.clientTop * scaleY;
    if (clipX) {
      left = Math.max(left, clipLeft - bounds.left);
      right = Math.max(
        right,
        bounds.right - (clipLeft + ancestor.clientWidth * scaleX),
      );
    }
    if (clipY) {
      top = Math.max(top, clipTop - bounds.top);
      bottom = Math.max(
        bottom,
        bounds.bottom - (clipTop + ancestor.clientHeight * scaleY),
      );
    }
  }

  if (
    left >= bounds.width ||
    right >= bounds.width ||
    top >= bounds.height ||
    bottom >= bounds.height ||
    left + right >= bounds.width ||
    top + bottom >= bounds.height
  )
    return "inset(50%)";
  return top === -3 && right === -3 && bottom === -3 && left === -3
    ? undefined
    : `inset(${top}px ${right}px ${bottom}px ${left}px)`;
}
