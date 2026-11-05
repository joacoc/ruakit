// Copyright 2026 RuaKit contributors. SPDX-License-Identifier: Apache-2.0
// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { createPointer } from '../src/experimental/index.js';

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

function setup() {
  const canvas = document.createElement('canvas');
  document.body.append(canvas);
  vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue(new DOMRect(100, 50, 400, 200));
  return { canvas, pointer: createPointer(canvas) };
}

it('drags a canvas object through pointer handlers with local coordinates and held-button state', async () => {
  const { canvas, pointer } = setup();
  let grabbed = false;
  let object = { x: 10, y: 20 };
  const events: PointerEvent[] = [];
  for (const type of ['pointermove', 'pointerdown', 'pointerup']) {
    canvas.addEventListener(type, (event) => {
      const e = event as PointerEvent;
      events.push(e);
      if (type === 'pointerdown') {
        grabbed = true;
      }
      if (type === 'pointermove' && grabbed) {
        object = { x: e.clientX - 100, y: e.clientY - 50 };
      }
      if (type === 'pointerup') {
        grabbed = false;
      }
    });
  }
  const mouse = vi.fn();
  canvas.addEventListener('mousemove', mouse);
  await pointer.drag(object, { x: 80, y: 90 }, { steps: 2, durationMs: 0 });
  expect(object).toEqual({ x: 80, y: 90 });
  expect(grabbed).toBe(false);
  expect(events.map((e) => [e.type, e.buttons])).toEqual([
    ['pointermove', 0],
    ['pointerdown', 1],
    ['pointermove', 1],
    ['pointermove', 1],
    ['pointerup', 0],
  ]);
  expect(events.every((e) => !e.isTrusted && e.pointerType === 'mouse')).toBe(true);
  expect(mouse).toHaveBeenCalledTimes(3);
});

it('cancels an interrupted drag and allows another press', async () => {
  const { canvas, pointer } = setup();
  const controller = new AbortController();
  const cancelled = vi.fn();
  canvas.addEventListener('pointercancel', cancelled);
  canvas.addEventListener('pointerdown', () => controller.abort(), { once: true });
  await expect(
    pointer.drag({ x: 0, y: 0 }, { x: 20, y: 20 }, { signal: controller.signal }),
  ).rejects.toBeDefined();
  expect(cancelled).toHaveBeenCalledTimes(1);
  await pointer.down({ x: 1, y: 1 });
  await pointer.up({ x: 2, y: 2 });
});

it('rejects overlapping operations and invalid coordinates', async () => {
  const { pointer } = setup();
  const drag = pointer.drag({ x: 0, y: 0 }, { x: 5, y: 5 }, { durationMs: 10, steps: 1 });
  await expect(pointer.move({ x: 1, y: 1 })).rejects.toMatchObject({ code: 'BUSY' });
  await drag;
  expect(() => pointer.move({ x: NaN, y: 0 })).toThrow();
});
