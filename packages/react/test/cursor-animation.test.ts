// Copyright 2026 RuaKit contributors. SPDX-License-Identifier: MIT
// @vitest-environment jsdom
import { act, createElement, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { RuntimeActionEvent } from '@ruakit/agent';
import { RuaCursor } from '../src/components/cursor.js';
import type {
  CursorAnchor,
  CursorVisibility,
  RuaCursorProps,
} from '../src/components/cursor.js';
import { cursorSpeedPixelsPerSecond } from '../src/lib/cursor-movement.js';
import { useCursorTiming } from '../src/hooks/use-cursor-timing.js';
import type { CursorTiming } from '../src/hooks/use-cursor-timing.js';
import { useRua } from '../src/hooks/use-rua.js';
import type { RuaAgent } from '../src/hooks/use-rua.js';

const animation = vi.hoisted(() => ({
  reportUpdates: true,
  update: undefined as ((point: { x: number; y: number }) => void) | undefined,
  complete: undefined as (() => void) | undefined,
  rotate: undefined as ((point: { rotate: number }) => void) | undefined,
  reducedMotion: false,
  destination: undefined as { x?: number | number[]; y?: number | number[] } | undefined,
  rotations: undefined as number[] | undefined,
  angle: undefined as number | undefined,
  duration: 0,
  rotationDuration: 0,
}));

// Capture the animation's mounted starting point; leave cursor state and effects real.
vi.mock('motion/react', async () => {
  const { createElement, useEffect, useRef } = await import('react');
  type AnimationProps = {
    initial?: { x?: number; y?: number };
    animate?: { x?: number | number[]; y?: number | number[]; rotate?: number | number[] };
    children?: import('react').ReactNode;
    transition?: { duration?: number };
    onAnimationStart?: unknown;
    onAnimationComplete?: () => void;
    onUpdate?: (point: { x: number; y: number }) => void;
    className?: string;
  };
  function component(tag: string) {
    return ({
      initial,
      animate,
      transition,
      onAnimationStart,
      onAnimationComplete,
      onUpdate,
      children,
      ...props
    }: AnimationProps) => {
      const origin = useRef(initial);
      if (props.className === 'ruakit-cursor-pointer') {
        animation.update = onUpdate;
        animation.complete = onAnimationComplete;
        animation.destination = animate;
        animation.duration = transition?.duration ?? 0;
      } else if (props.className === 'ruakit-cursor-heading') {
        animation.rotate = onUpdate as unknown as (point: { rotate: number }) => void;
        animation.rotations = Array.isArray(animate?.rotate) ? animate.rotate : undefined;
        animation.angle = typeof animate?.rotate === 'number' ? animate.rotate : undefined;
        animation.rotationDuration = transition?.duration ?? 0;
      }
      const x = Array.isArray(animate?.x) ? animate.x.at(-1) : animate?.x;
      const y = Array.isArray(animate?.y) ? animate.y.at(-1) : animate?.y;
      useEffect(() => {
        if (
          animation.reportUpdates &&
          typeof x === 'number' &&
          typeof y === 'number'
        )
          onUpdate?.({ x, y });
      }, [x, y]);
      return createElement(
        tag,
        {
          ...props,
          'data-from-x': origin.current?.x,
          'data-from-y': origin.current?.y,
          'data-to-x': x,
          'data-to-y': y,
        },
        children,
      );
    };
  }
  return {
    motion: { div: component('div'), span: component('span') },
    useReducedMotion: () => animation.reducedMotion,
  };
});

let root: Root | undefined;
beforeEach(() => {
  animation.reportUpdates = true;
  animation.update = undefined;
  animation.complete = undefined;
  animation.rotate = undefined;
  animation.reducedMotion = false;
  animation.destination = undefined;
  animation.rotations = undefined;
  animation.angle = undefined;
  vi.useFakeTimers();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(1);
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
});
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.clearAllTimers();
  vi.useRealTimers();
});

function action(id: number, rect: DOMRect): RuntimeActionEvent {
  const element = document.body.appendChild(document.createElement('button'));
  element.getBoundingClientRect = vi.fn(() => rect);
  return {
    id,
    element,
    rect,
    action: 'click',
    phase: 'before',
    durationMs: 500,
  };
}

async function render(
  action: RuntimeActionEvent | null,
  active = false,
  visibility: CursorVisibility = 'plan',
  anchor: CursorAnchor | null = null,
  strict = false,
  dragging = false,
  options: Pick<RuaCursorProps, 'edgeGlow' | 'scrollToTarget'> = {},
) {
  if (!root)
    root = createRoot(document.body.appendChild(document.createElement('div')));
  await act(async () =>
    root!.render(
      strict
        ? createElement(
            StrictMode,
            null,
            createElement(RuaCursor, { action, active, visibility, anchor, dragging, ...options }),
          )
        : createElement(RuaCursor, { action, active, visibility, anchor, dragging, ...options }),
    ),
  );
}

function pointer() {
  const element = document.querySelector<HTMLElement>('.ruakit-cursor-pointer');
  if (!element) throw new Error('The cursor is not visible.');
  return element;
}

it.each(['complete', 'cancel'] as const)(
  'allows the full journey from the chat anchor before filling a distant field (%s)',
  async (outcome) => {
    animation.reportUpdates = false;
    const chat = action(1, new DOMRect(60, 85, 80, 30)).element;
    const reached = vi.fn();
    let anchor: CursorAnchor | null = { element: chat, onReached: reached };
    const label = document.body.appendChild(document.createElement('label'));
    label.textContent = 'Email address';
    const input = label.appendChild(document.createElement('input'));
    input.getBoundingClientRect = () => new DOMRect(1760, 85, 80, 30);
    input.getClientRects = () => [input.getBoundingClientRect()] as unknown as DOMRectList;
    const target = { id: null, role: 'textbox', label: 'Email address', context: null, group: null };
    let rua!: RuaAgent;
    let timing!: CursorTiming;
    function Harness() {
      timing = useCursorTiming(500);
      rua = useRua({
        actionDelayMs: timing.actionDelayMs,
        request: async () => ({
          id: 'invite', message: 'Invite prepared',
          steps: [{ id: 'email', type: 'fill', message: 'Enter email', target, value: 'olivia.chen@ruakit.com' }],
          checks: [{ type: 'value', description: 'Email entered', control: target, equals: 'olivia.chen@ruakit.com' }],
        }),
      });
      return createElement(RuaCursor, {
        timing, action: rua.action, active: rua.loading, visibility: 'session', anchor,
      });
    }
    root = createRoot(document.body.appendChild(document.createElement('div')));
    await act(async () => root!.render(createElement(Harness)));
    await act(async () => {
      animation.update?.({ x: 100, y: 100 });
      animation.complete?.();
    });
    expect(reached).toHaveBeenCalledOnce();
    expect(timing.position.current).toMatchObject({ x: 100, y: 100 });
    anchor = null;
    await act(async () => root!.render(createElement(Harness)));
    let pending!: ReturnType<RuaAgent['execute']>;
    await act(async () => { pending = rua.execute({ prompt: 'Prepare the invitation' }); });
    const delay = rua.action!.durationMs;
    const travelMs = animation.duration * 1000;
    expect(rua.action?.phase).toBe('before');
    expect(travelMs).toBeGreaterThan(1400);
    expect(delay).toBeGreaterThan(travelMs);
    expect(animation.destination?.x).toBeInstanceOf(Array);
    expect((animation.destination!.x as number[])[0]).toBe(100);
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(input.value).toBe('');
    expect(document.activeElement).not.toBe(input);
    if (outcome === 'cancel') {
      await act(async () => { rua.cancel(); await pending; });
      await act(async () => { await vi.advanceTimersByTimeAsync(delay); });
      expect(await pending).toMatchObject({ status: 'cancelled' });
      expect(input.value).toBe('');
    } else {
      await act(async () => { await vi.advanceTimersByTimeAsync(Math.floor(travelMs) - 500); });
      expect(input.value).toBe('');
      await act(async () => {
        animation.update?.({ x: 1800, y: 100 });
        animation.complete?.();
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(delay - Math.floor(travelMs) + 1);
        await pending;
      });
      expect(await pending).toMatchObject({ status: 'completed' });
      expect(input.value).toBe('olivia.chen@ruakit.com');
      // The next action starts from the reached field rather than the chat.
      expect(timing.actionDelayMs(input)).toBe(500);
    }
  },
);

it.each([
  { reducedMotion: true, minimum: 500 },
  { reducedMotion: false, minimum: 0 },
])('skips cursor timing for immediate feedback: %j', async ({ reducedMotion, minimum }) => {
  animation.reducedMotion = reducedMotion;
  let timing!: CursorTiming;
  function Harness() {
    timing = useCursorTiming(minimum);
    return null;
  }
  root = createRoot(document.body.appendChild(document.createElement('div')));
  await act(async () => root!.render(createElement(Harness)));
  const target = action(1, new DOMRect(1800, 100, 80, 30)).element;
  expect(timing.actionDelayMs(target)).toBe(0);
});

it.each(['idle', 'cancelled', 'failed'] as const)(
  'starts the next movement at the last target across %s feedback',
  async (gap) => {
    const first = action(1, new DOMRect(100, 90, 80, 30));
    await render(first);
    expect(pointer().dataset.fromY).toBe(String(window.innerHeight - 40));
    await render({ ...first, phase: 'after' });
    expect(pointer().dataset.toX).toBe('140');
    expect(pointer().dataset.toY).toBe('105');

    await render(gap === 'idle' ? null : { ...first, phase: gap });
    expect(document.querySelector('[data-ruakit-cursor]')).toBeNull();

    await render(action(2, new DOMRect(500, 260, 100, 50)));
    expect(pointer().dataset.fromX).toBe('140');
    expect(pointer().dataset.fromY).toBe('105');
    expect(pointer().dataset.toX).toBe('550');
    expect(pointer().dataset.toY).toBe('285');
  },
);

it('keeps one visible pointer through planning pauses and subsequent actions until the plan settles', async () => {
  const first = action(1, new DOMRect(100, 90, 80, 30));
  await render(first, true);
  const initialPointer = pointer();
  await render({ ...first, phase: 'after' }, true);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1200);
  });
  expect(
    document.querySelector<HTMLElement>('[data-ruakit-cursor]')?.style.opacity,
  ).toBe('1');
  expect(pointer()).toBe(initialPointer);
  await render(action(2, new DOMRect(500, 260, 100, 50)), true);
  expect(pointer()).toBe(initialPointer);
  expect(pointer().dataset.toX).toBe('550');
  await render(null);
  expect(document.querySelector('[data-ruakit-cursor]')).toBeNull();
});

it('keeps the pointer when a completed action removes its target, without outlining the removed target', async () => {
  const first = action(1, new DOMRect(100, 90, 80, 30));
  await render(first, true);
  const initialPointer = pointer();
  first.element.remove();
  await render({ ...first, phase: 'after' }, true);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1200);
  });
  expect(
    document.querySelector<HTMLElement>('[data-ruakit-cursor]')?.style.opacity,
  ).toBe('1');
  expect(document.querySelector('.ruakit-cursor-highlight')).toBeNull();
  expect(pointer()).toBe(initialPointer);
  await render(action(2, new DOMRect(500, 260, 100, 50)), true);
  expect(pointer()).toBe(initialPointer);
  expect(document.querySelector('.ruakit-cursor-highlight')).not.toBeNull();
});

it('waits for the first action and keeps one pointer across completed plans in session mode', async () => {
  await render(null, false, 'session');
  expect(document.querySelector('[data-ruakit-cursor]')).toBeNull();
  const first = action(1, new DOMRect(100, 90, 80, 30));
  await render(first, true, 'session');
  const initialPointer = pointer();
  await render({ ...first, phase: 'after' }, true, 'session');
  await render(null, false, 'session');
  expect(pointer()).toBe(initialPointer);
  expect(pointer().dataset.toX).toBe('140');
  expect(pointer().dataset.toY).toBe('105');
  expect(
    document.querySelector('[data-ruakit-cursor]')?.getAttribute('data-phase'),
  ).toBe('idle');
  expect(document.querySelector('.ruakit-cursor-highlight')).toBeNull();
  expect(document.querySelector('.ruakit-cursor-click')).toBeNull();
  const frames = vi.mocked(window.requestAnimationFrame).mock.calls.length;
  const observations = vi.mocked(first.element.getBoundingClientRect).mock.calls
    .length;
  first.element.remove();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5000);
  });
  expect(pointer()).toBe(initialPointer);
  expect(
    document.querySelector<HTMLElement>('[data-ruakit-cursor]')?.style.opacity,
  ).toBe('1');
  expect(window.requestAnimationFrame).toHaveBeenCalledTimes(frames);
  expect(first.element.getBoundingClientRect).toHaveBeenCalledTimes(
    observations,
  );
  await render(action(2, new DOMRect(500, 260, 100, 50)), true, 'session');
  expect(pointer()).toBe(initialPointer);
  expect(pointer().dataset.toX).toBe('550');
  expect(pointer().dataset.toY).toBe('285');
});

it.each(['cancelled', 'failed'] as const)(
  'freezes at the current displayed position after %s feedback in session mode',
  async (phase) => {
    const first = action(1, new DOMRect(500, 260, 100, 50));
    await render(first, true, 'session');
    const initialPointer = pointer();
    animation.update?.({ x: 230, y: 145 });
    await render({ ...first, phase }, true, 'session');
    await render(null, false, 'session');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1200);
    });
    expect(pointer()).toBe(initialPointer);
    expect(pointer().dataset.toX).toBe('230');
    expect(pointer().dataset.toY).toBe('145');
    expect(pointer().getAttribute('data-moving')).toBe('false');
    expect(document.querySelector('.ruakit-cursor-highlight')).toBeNull();
    expect(document.querySelector('.ruakit-cursor-click')).toBeNull();
    expect(
      document.querySelector<HTMLElement>('[data-ruakit-cursor]')?.style
        .opacity,
    ).toBe('1');
  },
);

it('can switch visibility policies while idle and removes the cursor when unmounted', async () => {
  await render(action(1, new DOMRect(100, 90, 80, 30)), true, 'session');
  await render(null, false, 'session');
  await render(null, false, 'plan');
  expect(document.querySelector('[data-ruakit-cursor]')).toBeNull();
  await render(null, false, 'session');
  expect(pointer().dataset.toX).toBe('140');
  expect(pointer().dataset.toY).toBe('105');
  await act(async () => root?.unmount());
  root = undefined;
  expect(document.querySelector('[data-ruakit-cursor]')).toBeNull();
});

it('retains the target position for immediate actions without animation update callbacks', async () => {
  animation.reportUpdates = false;
  await render(
    { ...action(1, new DOMRect(100, 90, 80, 30)), durationMs: 0 },
    true,
    'session',
  );
  await render(null, false, 'session');
  expect(pointer().dataset.toX).toBe('140');
  expect(pointer().dataset.toY).toBe('105');
});

it('reports arrival at a presentation anchor only when its movement has completed', async () => {
  animation.reportUpdates = false;
  const element = action(1, new DOMRect(300, 200, 1, 1)).element;
  const onReached = vi.fn();
  await render(null, false, 'session', { element, onReached });
  expect(document.querySelector('.ruakit-cursor-highlight')).toBeNull();
  expect(onReached).not.toHaveBeenCalled();
  animation.update?.({ x: 100, y: 100 });
  await act(async () => animation.complete?.());
  expect(onReached).not.toHaveBeenCalled();
  animation.update?.({ x: 300.5, y: 200.5 });
  await act(async () => animation.complete?.());
  expect(onReached).toHaveBeenCalledOnce();
  await act(async () => animation.complete?.());
  expect(onReached).toHaveBeenCalledOnce();
});

it('allows distant presentation anchors enough time to travel at a readable speed', async () => {
  await render({ ...action(1, new DOMRect(100, 90, 80, 30)), durationMs: 0 }, true);
  const element = action(2, new DOMRect(2100, 90, 80, 30)).element;
  await render(null, true, 'plan', { element });
  expect(animation.duration).toBeCloseTo(2000 / cursorSpeedPixelsPerSecond, 2);
});

it.each([10, 120, 500])('keeps the fixed cursor speed even with %s ms action feedback', async (durationMs) => {
  await render({ ...action(1, new DOMRect(100, 90, 80, 30)), durationMs: 0 }, true);
  await render({ ...action(2, new DOMRect(2100, 90, 80, 30)), durationMs }, true);
  expect(animation.duration).toBeCloseTo(2000 / cursorSpeedPixelsPerSecond, 2);
});

it.each([false, true])('finishes a long journey without snapping when the action finishes early (active: %s)', async (active) => {
  await render({ ...action(1, new DOMRect(100, 90, 80, 30)), durationMs: 0 }, true);
  animation.reportUpdates = false;
  const event = action(2, new DOMRect(2100, 90, 80, 30));
  await render(event, active);
  const destination = animation.destination;
  const duration = animation.duration;
  animation.update?.({ x: 600, y: 105 });
  await render({ ...event, phase: 'after' }, active);
  expect(animation.destination?.x).toBe(destination?.x);
  expect(animation.destination?.y).toBe(destination?.y);
  expect(animation.duration).toBe(duration);
  expect(document.querySelector('.ruakit-cursor-click')).toBeNull();
  const layer = document.querySelector<HTMLElement>('[data-ruakit-cursor]')!;
  window.dispatchEvent(new Event('resize'));
  expect(layer.dataset.offscreen).toBe('false');
  await act(async () => vi.advanceTimersByTimeAsync(1000));
  expect(layer.style.opacity).toBe('1');
  animation.update?.({ x: 2140, y: 105 });
  animation.rotate?.({ rotate: 118 });
  await act(async () => animation.complete?.());
  expect(animation.duration).toBe(0);
  expect(animation.angle).toBe(0);
  expect(animation.rotationDuration).toBeGreaterThan(0);
  expect(document.querySelector('.ruakit-cursor-click')).not.toBeNull();
  await act(async () => vi.mocked(window.requestAnimationFrame).mock.calls.at(-1)?.[0](16));
  await act(async () => vi.advanceTimersByTimeAsync(650));
  expect(layer.style.opacity).toBe(active ? '1' : '0');
});

it('returns to the nearest equivalent resting angle only after arriving', async () => {
  animation.reportUpdates = false;
  const event = action(1, new DOMRect(100, 90, 80, 30));
  await render(event, true);
  animation.update?.({ x: 230, y: 145 });
  animation.rotate?.({ rotate: 359 });
  expect(animation.angle).toBeUndefined();
  animation.update?.({ x: 140, y: 105 });
  await act(async () => animation.complete?.());
  expect(animation.duration).toBe(0);
  expect(animation.angle).toBe(360);
  expect(animation.rotationDuration).toBeGreaterThan(0);
});

it('reports immediate arrival for zero-duration anchors and an already reached destination', async () => {
  const element = action(1, new DOMRect(300, 200, 1, 1)).element;
  const first = vi.fn();
  await render(null, false, 'session', {
    element,
    durationMs: 0,
    onReached: first,
  });
  expect(first).toHaveBeenCalledOnce();
  const next = vi.fn();
  await render(null, false, 'session', { element, onReached: next });
  expect(next).toHaveBeenCalledOnce();
});

it('waits for actual anchor arrival through Strict Mode effect replay', async () => {
  animation.reportUpdates = false;
  const element = action(1, new DOMRect(300, 200, 1, 1)).element;
  const onReached = vi.fn();
  await render(null, false, 'session', { element, onReached }, true);
  expect(onReached).not.toHaveBeenCalled();
  animation.update?.({ x: 300.5, y: 200.5 });
  await act(async () => animation.complete?.());
  expect(onReached).toHaveBeenCalledOnce();
});

it('gives runtime actions priority over presentation anchors', async () => {
  const runtime = action(1, new DOMRect(100, 90, 80, 30));
  const element = action(2, new DOMRect(300, 200, 1, 1)).element;
  const onReached = vi.fn();
  await render(runtime, true, 'session', { element, onReached });
  expect(pointer().dataset.toX).toBe('140');
  expect(pointer().dataset.toY).toBe('105');
  await act(async () => animation.complete?.());
  expect(onReached).not.toHaveBeenCalled();
});

it('ignores completion callbacks from a replaced presentation anchor', async () => {
  animation.reportUpdates = false;
  const first = {
    element: action(1, new DOMRect(300, 200, 1, 1)).element,
    onReached: vi.fn(),
  };
  await render(null, false, 'session', first);
  const completeFirst = animation.complete;
  const next = {
    element: action(2, new DOMRect(400, 300, 1, 1)).element,
    onReached: vi.fn(),
  };
  await render(null, false, 'session', next);
  animation.update?.({ x: 400.5, y: 300.5 });
  await act(async () => completeFirst?.());
  expect(first.onReached).not.toHaveBeenCalled();
  expect(next.onReached).not.toHaveBeenCalled();
  await act(async () => animation.complete?.());
  expect(next.onReached).toHaveBeenCalledOnce();
});

it('retargets from the displayed position and chooses the nearest angle along the new path', async () => {
  animation.reportUpdates = false;
  await render(action(1, new DOMRect(100, 90, 80, 30)), true);
  animation.update?.({ x: 230, y: 145 });
  animation.rotate?.({ rotate: 359 });
  await render(action(2, new DOMRect(500, 260, 100, 50)), true);
  expect((animation.destination?.x as number[])[0]).toBe(230);
  expect((animation.destination?.y as number[])[0]).toBe(145);
  expect(Math.abs(animation.rotations![0]! - 359)).toBeLessThanOrEqual(180);
  expect(pointer().dataset.toX).toBe('550');
  expect(pointer().dataset.toY).toBe('285');
});

it('does not restart travel for label changes', async () => {
  animation.reportUpdates = false;
  const first = action(1, new DOMRect(100, 90, 80, 30));
  await render(first, true);
  const path = animation.destination?.x;
  animation.update?.({ x: 230, y: 145 });
  await act(async () => root!.render(createElement(RuaCursor, {
    action: first, active: true, label: 'Helper',
  })));
  expect(animation.destination?.x).toBe(path);
});

it('skips movement and rotation for reduced motion and still reports anchor arrival', async () => {
  animation.reducedMotion = true;
  const element = action(1, new DOMRect(300, 200, 1, 1)).element;
  const onReached = vi.fn();
  await render(null, false, 'session', { element, onReached });
  expect(animation.duration).toBe(0);
  expect(animation.rotations).toBeUndefined();
  expect(pointer().dataset.toX).toBe('300.5');
  expect(pointer().dataset.toY).toBe('200.5');
  expect(onReached).toHaveBeenCalledOnce();
});

it('cancels target tracking when unmounted', async () => {
  await render(action(1, new DOMRect(100, 90, 80, 30)), true);
  const cancel = vi.mocked(window.cancelAnimationFrame);
  const count = cancel.mock.calls.length;
  await act(async () => root?.unmount());
  root = undefined;
  expect(cancel.mock.calls.length).toBeGreaterThan(count);
  expect(document.querySelector('[data-ruakit-cursor]')).toBeNull();
});

it('performs actions and follows their moving target in the normal orientation', async () => {
  const first = action(1, new DOMRect(100, 90, 80, 30));
  await render(first, true);
  animation.rotate?.({ rotate: 75 });
  await render({ ...first, phase: 'after' }, true);
  expect(animation.duration).toBe(0);
  expect(animation.angle).toBe(0);
  expect(document.querySelector('.ruakit-cursor-click')).not.toBeNull();
  vi.mocked(first.element.getBoundingClientRect).mockReturnValue(new DOMRect(140, 120, 80, 30));
  await act(async () => vi.mocked(window.requestAnimationFrame).mock.calls.at(-1)?.[0](16));
  expect(animation.destination).toEqual({ x: 180, y: 135 });
  expect(animation.angle).toBe(0);
});

it('keeps the normal orientation on subsequent actions that move an already reached object', async () => {
  const first = action(1, new DOMRect(100, 90, 80, 30));
  await render(first, true);
  await act(async () => animation.complete?.());
  vi.mocked(first.element.getBoundingClientRect).mockReturnValue(new DOMRect(120, 90, 80, 30));
  await render({ ...first, id: 2, action: 'key' }, true);
  expect(animation.destination).toEqual({ x: 160, y: 105 });
  expect(animation.duration).toBe(0);
  expect(animation.angle).toBe(0);
});

it('follows a dragged object directly with the normal pointer even if travel was interrupted', async () => {
  animation.reportUpdates = false;
  const first = action(1, new DOMRect(100, 90, 80, 30));
  await render(first, true);
  animation.update?.({ x: 230, y: 145 });
  animation.rotate?.({ rotate: 85 });
  await render(first, true, 'plan', null, false, true);
  expect(animation.duration).toBe(0);
  expect(animation.angle).toBe(0);
  expect(animation.destination).toEqual({ x: 140, y: 105 });
  vi.mocked(first.element.getBoundingClientRect).mockReturnValue(new DOMRect(300, 250, 80, 30));
  await act(async () => vi.mocked(window.requestAnimationFrame).mock.calls.at(-1)?.[0](16));
  expect(animation.destination).toEqual({ x: 340, y: 265 });
  expect(animation.angle).toBe(0);
});

it('aims at the full center of a partially visible target on mobile', async () => {
  vi.stubGlobal('innerWidth', 390);
  vi.stubGlobal('innerHeight', 844);
  await render({ ...action(1, new DOMRect(-20, -20, 80, 80)), durationMs: 0 }, true);
  expect(pointer().dataset.toX).toBe('20');
  expect(pointer().dataset.toY).toBe('20');
  expect(document.querySelector<HTMLElement>('[data-ruakit-cursor]')?.dataset.offscreen).toBe('false');
});

it.each([
  [-60, 160, ['left']],
  [460, 160, ['right']],
  [160, -60, ['top']],
  [160, 960, ['bottom']],
  [-60, -60, ['left', 'top']],
  [460, 960, ['right', 'bottom']],
] as const)('keeps an off-screen target at (%s, %s) and signals the matching edges', async (x, y, edges) => {
  vi.stubGlobal('innerWidth', 390);
  vi.stubGlobal('innerHeight', 844);
  await render({ ...action(1, new DOMRect(x - 40, y - 15, 80, 30)), durationMs: 0 }, true);
  expect(pointer().dataset.toX).toBe(String(x));
  expect(pointer().dataset.toY).toBe(String(y));
  const layer = document.querySelector<HTMLElement>('[data-ruakit-cursor]')!;
  expect(layer.dataset.offscreen).toBe('true');
  for (const edge of ['left', 'right', 'top', 'bottom'] as const)
    expect(layer.getAttribute(`data-edge-${edge}`)).toBe(String((edges as readonly string[]).includes(edge)));
  expect(document.querySelector('.ruakit-cursor-highlight')).not.toBeNull();
});

it('can hide and restore edge glows without changing an off-screen cursor or its outline', async () => {
  const event = { ...action(1, new DOMRect(100, 1400, 80, 30)), durationMs: 0 };
  await render(event, true);
  const originalPointer = pointer();
  expect(document.querySelectorAll('.ruakit-cursor-edge')).toHaveLength(4);
  await render(event, true, 'plan', null, false, false, { edgeGlow: false });
  expect(document.querySelectorAll('.ruakit-cursor-edge')).toHaveLength(0);
  expect(pointer()).toBe(originalPointer);
  expect(document.querySelector<HTMLElement>('[data-ruakit-cursor]')?.dataset.offscreen).toBe('true');
  expect(document.querySelector('.ruakit-cursor-highlight')).not.toBeNull();
  await render(event, true);
  expect(document.querySelectorAll('.ruakit-cursor-edge')).toHaveLength(4);
});

it.each(['action', 'anchor'] as const)('only scrolls to a presentation %s when enabled', async (kind) => {
  const event = action(1, new DOMRect(100, 1400, 80, 30));
  const scrollIntoView = vi.fn();
  event.element.scrollIntoView = scrollIntoView;
  const anchor = kind === 'anchor' ? { element: event.element } : null;
  const feedback = kind === 'action' ? event : null;
  await render(feedback, true, 'plan', anchor);
  expect(scrollIntoView).not.toHaveBeenCalled();
  await render(feedback, true, 'plan', anchor, false, false, { scrollToTarget: true });
  expect(scrollIntoView).toHaveBeenCalledExactlyOnceWith({
    block: 'nearest', inline: 'nearest', behavior: 'instant',
  });
  await render(feedback && { ...feedback, phase: 'after' }, true, 'plan', anchor, false, false, { scrollToTarget: true });
  expect(scrollIntoView).toHaveBeenCalledTimes(1);
  await render(feedback, true, 'plan', anchor, false, false, { scrollToTarget: false });
  await act(async () => vi.mocked(window.requestAnimationFrame).mock.calls.at(-1)?.[0](16));
  expect(scrollIntoView).toHaveBeenCalledTimes(1);
});

it('signals the displayed cursor during animated travel instead of the off-screen destination', async () => {
  animation.reportUpdates = false;
  vi.stubGlobal('innerWidth', 390);
  vi.stubGlobal('innerHeight', 844);
  await render(action(1, new DOMRect(100, -200, 80, 30)), true);
  const layer = document.querySelector<HTMLElement>('[data-ruakit-cursor]')!;
  expect(layer.dataset.offscreen).toBe('false');
  animation.update?.({ x: 140, y: -40 });
  expect(layer.dataset.offscreen).toBe('true');
  expect(layer.dataset.edgeTop).toBe('true');
  animation.update?.({ x: 140, y: 50 });
  expect(layer.dataset.offscreen).toBe('false');
  expect(layer.dataset.edgeTop).toBe('false');
});

it('lets scrolling hide and reveal an idle cursor at the same document position', async () => {
  vi.stubGlobal('scrollX', 0);
  vi.stubGlobal('scrollY', 0);
  await render({ ...action(1, new DOMRect(100, 90, 80, 30)), durationMs: 0 }, true, 'session');
  await render(null, false, 'session');
  const idlePointer = pointer();
  const layer = document.querySelector<HTMLElement>('[data-ruakit-cursor]')!;
  const content = document.querySelector<HTMLElement>('.ruakit-cursor-content')!;
  window.scrollX = 200;
  window.scrollY = 200;
  window.dispatchEvent(new Event('scroll'));
  expect(layer.dataset.edgeTop).toBe('true');
  expect(layer.dataset.edgeLeft).toBe('true');
  expect(content.style.transform).toBe('translate(-200px, -200px)');
  expect(idlePointer.dataset.toX).toBe('140');
  expect(idlePointer.dataset.toY).toBe('105');
  window.scrollX = 0;
  window.scrollY = 0;
  window.dispatchEvent(new Event('scroll'));
  expect(layer.dataset.offscreen).toBe('false');
  expect(pointer()).toBe(idlePointer);
});

it('starts in the visible area of an already scrolled page and does not restart travel on scroll', async () => {
  animation.reportUpdates = false;
  vi.stubGlobal('scrollX', 100);
  vi.stubGlobal('scrollY', 600);
  const first = action(1, new DOMRect(100, 900, 80, 30));
  await render(first, true);
  expect(pointer().dataset.fromX).toBe(String(100 + window.innerWidth / 2));
  expect(pointer().dataset.fromY).toBe(String(600 + window.innerHeight - 40));
  expect(pointer().dataset.toX).toBe('240');
  expect(pointer().dataset.toY).toBe('1515');
  const path = animation.destination?.y;
  animation.update?.({ x: 240, y: 1200 });
  window.scrollY = 1000;
  vi.mocked(first.element.getBoundingClientRect).mockReturnValue(new DOMRect(100, 500, 80, 30));
  window.dispatchEvent(new Event('scroll'));
  await act(async () => vi.mocked(window.requestAnimationFrame).mock.calls.at(-1)?.[0](16));
  expect(animation.destination?.y).toBe(path);
  expect(document.querySelector<HTMLElement>('[data-ruakit-cursor]')?.dataset.offscreen).toBe('false');
  expect(document.querySelector<HTMLElement>('.ruakit-cursor-content')?.style.transform).toBe('translate(-100px, -1000px)');
});

it('keeps following a target when a nested scroll container moves it off-screen and back', async () => {
  const first = action(1, new DOMRect(100, 90, 80, 30));
  await render({ ...first, phase: 'after' }, true);
  const layer = document.querySelector<HTMLElement>('[data-ruakit-cursor]')!;
  vi.mocked(first.element.getBoundingClientRect).mockReturnValue(new DOMRect(100, -200, 80, 30));
  await act(async () => vi.mocked(window.requestAnimationFrame).mock.calls.at(-1)?.[0](16));
  expect(pointer().dataset.toY).toBe('-185');
  expect(layer.dataset.edgeTop).toBe('true');
  vi.mocked(first.element.getBoundingClientRect).mockReturnValue(new DOMRect(100, 90, 80, 30));
  await act(async () => vi.mocked(window.requestAnimationFrame).mock.calls.at(-1)?.[0](32));
  expect(pointer().dataset.toY).toBe('105');
  expect(layer.dataset.offscreen).toBe('false');
});

it('updates edge glows for mobile keyboard, zoom, and visual viewport scrolling', async () => {
  const viewport = Object.assign(new EventTarget(), {
    offsetLeft: 40, offsetTop: 120, width: 300, height: 400,
  });
  vi.stubGlobal('visualViewport', viewport);
  const removeListener = vi.spyOn(viewport, 'removeEventListener');
  await render({ ...action(1, new DOMRect(60, 585, 80, 30)), durationMs: 0 }, true, 'session');
  const layer = document.querySelector<HTMLElement>('[data-ruakit-cursor]')!;
  expect(layer.style.left).toBe('40px');
  expect(layer.style.top).toBe('120px');
  expect(layer.style.width).toBe('300px');
  expect(layer.style.height).toBe('400px');
  expect(layer.dataset.edgeBottom).toBe('true');
  expect(document.querySelector<HTMLElement>('.ruakit-cursor-content')?.style.transform).toBe('translate(-40px, -120px)');
  viewport.height = 600;
  viewport.dispatchEvent(new Event('resize'));
  expect(layer.dataset.offscreen).toBe('false');
  viewport.offsetLeft = 150;
  viewport.dispatchEvent(new Event('scroll'));
  expect(layer.dataset.edgeLeft).toBe('true');
  expect(layer.dataset.edgeBottom).toBe('false');
  await act(async () => root?.unmount());
  root = undefined;
  expect(removeListener.mock.calls.map(([type]) => type)).toEqual(['scroll', 'resize']);
});

it('reaches an off-screen presentation anchor so the mobile tour can continue', async () => {
  animation.reportUpdates = false;
  const element = action(1, new DOMRect(100, 1400, 1, 1)).element;
  const onReached = vi.fn();
  await render(null, false, 'session', { element, onReached });
  expect(onReached).not.toHaveBeenCalled();
  animation.update?.({ x: 100.5, y: 1400.5 });
  await act(async () => animation.complete?.());
  expect(onReached).toHaveBeenCalledOnce();
  expect(document.querySelector<HTMLElement>('[data-ruakit-cursor]')?.dataset.edgeBottom).toBe('true');
});
