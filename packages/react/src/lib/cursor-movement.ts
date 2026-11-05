// Copyright 2026 RuaKit contributors. SPDX-License-Identifier: MIT

export const cursorSpeedPixelsPerSecond = 1200;
const distanceSampleCount = 240;
const trajectorySampleCount = 60;

interface Point {
  x: number;
  y: number;
}

export interface Trajectory {
  x: number[];
  y: number[];
  rotation: number[];
  /** Seconds at the fixed travel speed. */
  duration: number;
}

// The SVG points approximately 125 degrees counterclockwise from right.
const arrowOffset = 125;

function shortestTurn(from: number, to: number): number {
  return ((((to - from + 180) % 360) + 360) % 360) - 180;
}

/** The nearest equivalent of the normal arrow orientation, without a full turn. */
export function cursorRestingRotation(rotation: number): number {
  return rotation + shortestTurn(rotation, 0);
}

/** One shallow C-shaped curve, sampled by distance at a constant speed. */
export function createCursorTrajectory(
  from: Point,
  to: Point,
  animate: boolean,
  previousRotation: number | undefined,
  viewport: { left?: number; top?: number; width: number; height: number },
): Trajectory {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.hypot(dx, dy);

  if (!animate || distance < 0.5)
    return {
      x: [from.x, to.x],
      y: [from.y, to.y],
      rotation: [0, 0],
      duration: 0,
    };

  // Bound the bend to 3% of the journey and 24 px, even on very large screens.
  const bend = Math.min(
    24,
    distance * 0.03,
    Math.min(viewport.width, viewport.height) * 0.04,
  );
  const left = Math.min(viewport.left ?? 0, from.x, to.x);
  const top = Math.min(viewport.top ?? 0, from.y, to.y);
  const right = Math.max((viewport.left ?? 0) + viewport.width, from.x, to.x);
  const bottom = Math.max((viewport.top ?? 0) + viewport.height, from.y, to.y);
  const control = {
    x: Math.max(
      left,
      Math.min(right, (from.x + to.x) / 2 - (dy / distance) * bend * 2),
    ),
    y: Math.max(
      top,
      Math.min(bottom, (from.y + to.y) / 2 + (dx / distance) * bend * 2),
    ),
  };

  // A single quadratic has no inflection, loop, overshoot, or separate arrival curve.
  const pointAt = (t: number): Point => ({
    x: (1 - t) ** 2 * from.x + 2 * (1 - t) * t * control.x + t * t * to.x,
    y: (1 - t) ** 2 * from.y + 2 * (1 - t) * t * control.y + t * t * to.y,
  });

  const samples: { t: number; length: number }[] = [];
  let previous = from;
  let totalLength = 0;

  for (let index = 0; index <= distanceSampleCount; index++) {
    const t = index / distanceSampleCount;
    const point = pointAt(t);

    totalLength += Math.hypot(point.x - previous.x, point.y - previous.y);
    samples.push({ t, length: totalLength });
    previous = point;
  }

  const result: Trajectory = {
    x: [],
    y: [],
    rotation: [],
    duration: totalLength / cursorSpeedPixelsPerSecond,
  };
  let heading = previousRotation ?? 0;
  let cursor = 1;

  for (let index = 0; index <= trajectorySampleCount; index++) {
    const time = index / trajectorySampleCount;
    const length = time * totalLength;
    while (cursor < samples.length - 1 && samples[cursor]!.length < length)
      cursor++;

    const lower = samples[cursor - 1]!;
    const upper = samples[cursor]!;
    const fraction =
      (length - lower.length) / (upper.length - lower.length || 1);
    const t = lower.t + (upper.t - lower.t) * fraction;
    const point = pointAt(t);
    const tangentX = (1 - t) * (control.x - from.x) + t * (to.x - control.x);
    const tangentY = (1 - t) * (control.y - from.y) + t * (to.y - control.y);

    heading += shortestTurn(
      heading,
      (Math.atan2(tangentY, tangentX) * 180) / Math.PI + arrowOffset,
    );

    result.x.push(
      index === 0 ? from.x : index === trajectorySampleCount ? to.x : point.x,
    );
    result.y.push(
      index === 0 ? from.y : index === trajectorySampleCount ? to.y : point.y,
    );
    // Stay tangent to the path through arrival. Resting rotation happens at rest.
    result.rotation.push(heading);
  }

  return result;
}
