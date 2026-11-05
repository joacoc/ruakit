// Copyright 2026 RuaKit contributors. SPDX-License-Identifier: MIT
import { expect, it } from 'vitest';
import { createCursorTrajectory, cursorSpeedPixelsPerSecond } from '../src/lib/cursor-movement.js';

const from = { x: 100, y: 200 };
const to = { x: 500, y: 200 };
const viewport = { width: 800, height: 600 };
const path = () => createCursorTrajectory(from, to, true, undefined, viewport);

function lengthOf(trajectory: ReturnType<typeof path>): number {
  return trajectory.x.slice(1).reduce((length, x, index) => length + Math.hypot(
    x - trajectory.x[index]!, trajectory.y[index + 1]! - trajectory.y[index]!,
  ), 0);
}

it('follows one narrow C curve and arrives exactly without an extra arrival bend', () => {
  const trajectory = path();
  expect([trajectory.x[0], trajectory.y[0]]).toEqual([from.x, from.y]);
  expect([trajectory.x.at(-1), trajectory.y.at(-1)]).toEqual([to.x, to.y]);
  expect(trajectory.x.every((x) => x >= from.x && x <= to.x)).toBe(true);
  expect(trajectory.x.at(-2)).toBeLessThan(to.x);
  expect(trajectory.y.every((y) => y >= from.y && y <= from.y + 12.001)).toBe(true);
  expect(Math.max(...trajectory.y)).toBeGreaterThan(from.y + 11);
  const peak = trajectory.y.indexOf(Math.max(...trajectory.y));
  for (let i = 1; i <= peak; i++) expect(trajectory.y[i]).toBeGreaterThanOrEqual(trajectory.y[i - 1]!);
  for (let i = peak + 1; i < trajectory.y.length; i++) expect(trajectory.y[i]).toBeLessThanOrEqual(trajectory.y[i - 1]!);
  expect(trajectory).toEqual(path());
});

it.each([
  { x: 600, y: 200 }, { x: 600, y: 500 }, { x: 100, y: 500 },
  { x: 10, y: 500 }, { x: 10, y: 200 }, { x: 10, y: 10 },
  { x: 100, y: 10 }, { x: 600, y: 10 }, { x: 100, y: -1800 },
])('never crosses into an S curve or overshoots when travelling to %j', (target) => {
  const trajectory = createCursorTrajectory(from, target, true, undefined, viewport);
  const dx = target.x - from.x;
  const dy = target.y - from.y;
  const distance = Math.hypot(dx, dy);
  let previousProgress = -1;
  for (let i = 0; i < trajectory.x.length; i++) {
    const x = trajectory.x[i]! - from.x;
    const y = trajectory.y[i]! - from.y;
    const lateral = (dx * y - dy * x) / distance;
    const progress = (dx * x + dy * y) / (distance * distance);
    expect(lateral).toBeGreaterThanOrEqual(-0.00001);
    expect(lateral).toBeLessThanOrEqual(24.00001);
    expect(progress).toBeGreaterThanOrEqual(previousProgress);
    expect(progress).toBeLessThanOrEqual(1.00001);
    previousProgress = progress;
  }
  const turns: number[] = [];
  for (let i = 2; i < trajectory.x.length; i++) {
    const ax = trajectory.x[i - 1]! - trajectory.x[i - 2]!;
    const ay = trajectory.y[i - 1]! - trajectory.y[i - 2]!;
    const bx = trajectory.x[i]! - trajectory.x[i - 1]!;
    const by = trajectory.y[i]! - trajectory.y[i - 1]!;
    turns.push(ax * by - ay * bx);
  }
  expect(turns.every((turn) => turn <= 0.00001)).toBe(true);
});

it.each([10, 100, 400, 2000, 8000])('travels %s px at the fixed speed including the start and finish', (distance) => {
  const trajectory = createCursorTrajectory(
    from, { x: from.x + distance, y: from.y }, true, undefined,
    { width: 10000, height: 1200 },
  );
  expect(lengthOf(trajectory) / trajectory.duration).toBeCloseTo(cursorSpeedPixelsPerSecond, 1);
  const frameTime = trajectory.duration / 60;
  for (let i = 1; i < trajectory.x.length; i++) {
    const speed = Math.hypot(
      trajectory.x[i]! - trajectory.x[i - 1]!, trajectory.y[i]! - trajectory.y[i - 1]!,
    ) / frameTime;
    expect(speed).toBeGreaterThan(cursorSpeedPixelsPerSecond - 1);
    expect(speed).toBeLessThan(cursorSpeedPixelsPerSecond + 1);
  }
});

it('keeps the bend at most 24 pixels even for a very distant destination', () => {
  const trajectory = createCursorTrajectory(from, { x: 8100, y: 200 }, true, undefined, { width: 10000, height: 2000 });
  expect(Math.max(...trajectory.y)).toBeLessThanOrEqual(224.001);
  expect(trajectory.duration).toBeGreaterThan(8000 / cursorSpeedPixelsPerSecond);
});

it.each([0, 55, 60, 90, 180, -90])('keeps the tip aligned with the path throughout a %s-degree journey', (angle) => {
  const radians = angle * Math.PI / 180;
  const origin = { x: 400, y: 400 };
  const trajectory = createCursorTrajectory(origin, {
    x: origin.x + 300 * Math.cos(radians),
    y: origin.y + 300 * Math.sin(radians),
  }, true, 350, viewport);
  for (let i = 0; i < trajectory.x.length; i++) {
    const before = Math.max(0, i - 1);
    const after = Math.min(trajectory.x.length - 1, i + 1);
    const dx = trajectory.x[after]! - trajectory.x[before]!;
    const dy = trajectory.y[after]! - trajectory.y[before]!;
    // The unrotated SVG points 125 degrees counterclockwise from right.
    const facing = (trajectory.rotation[i]! - 125) * Math.PI / 180;
    const alignment = (Math.cos(facing) * dx + Math.sin(facing) * dy) / Math.hypot(dx, dy);
    expect(alignment).toBeGreaterThan(0.99999);
    if (i > 0)
      expect(Math.abs(trajectory.rotation[i]! - trajectory.rotation[i - 1]!)).toBeLessThan(1);
  }
});

it('skips travel for stationary or explicitly immediate feedback', () => {
  const still = createCursorTrajectory(from, from, true, 42, viewport);
  const immediate = createCursorTrajectory(from, to, false, 42, viewport);
  expect(still.duration).toBe(0);
  expect(immediate.duration).toBe(0);
  expect(immediate.rotation).toEqual([0, 0]);
});

it('stays within the viewport near its edges', () => {
  const trajectory = createCursorTrajectory({ x: 1, y: 1 }, { x: 799, y: 1 }, true, undefined, viewport);
  expect(trajectory.x.every((x) => x >= 0 && x <= viewport.width)).toBe(true);
  expect(trajectory.y.every((y) => y >= 0 && y <= viewport.height)).toBe(true);
});

it('continues to off-screen targets at the same speed without collapsing at the screen edge', () => {
  const trajectory = createCursorTrajectory(from, { x: 100, y: -1800 }, true, undefined, viewport);
  expect([trajectory.x.at(-1), trajectory.y.at(-1)]).toEqual([100, -1800]);
  expect(trajectory.y.filter((y) => y < -100).length).toBeGreaterThan(25);
  expect(lengthOf(trajectory) / trajectory.duration).toBeCloseTo(cursorSpeedPixelsPerSecond, 1);
});

it('shapes travel in document coordinates when the viewport is scrolled', () => {
  const trajectory = createCursorTrajectory(
    { x: 101, y: 1001 }, { x: 899, y: 1001 }, true, undefined,
    { left: 100, top: 1000, width: 800, height: 600 },
  );
  expect(trajectory.x.every((x) => x >= 100 && x <= 900)).toBe(true);
  expect(trajectory.y.every((y) => y >= 1000 && y <= 1600)).toBe(true);
});
