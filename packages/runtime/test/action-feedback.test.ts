// Copyright 2026 RuaKit contributors. SPDX-License-Identifier: Apache-2.0
// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { withActionFeedback } from '../src/action-feedback.js';
import type { RuntimeActionEvent } from '../src/types.js';

afterEach(() => {
  document.body.replaceChildren();
  vi.useRealTimers();
});

it('resolves travel time after scrolling and waits for it before performing the action', async () => {
  vi.useFakeTimers();
  const element = document.body.appendChild(document.createElement('button'));
  let scrolled = false;
  element.scrollIntoView = () => { scrolled = true; };
  const events: RuntimeActionEvent[] = [];
  const effect = vi.fn();
  const pending = withActionFeedback({
    scrollToTarget: true,
    actionDelayMs: (target) => {
      expect(target).toBe(element);
      expect(scrolled).toBe(true);
      return 1234;
    },
    onAction: (event) => events.push(event),
  }, 'click', () => element, new AbortController().signal, effect);
  expect(events.map(({ phase, durationMs }) => [phase, durationMs])).toEqual([['before', 1234]]);
  await vi.advanceTimersByTimeAsync(1233);
  expect(effect).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  await pending;
  expect(effect).toHaveBeenCalledOnce();
  expect(events.map(({ phase, durationMs }) => [phase, durationMs])).toEqual([
    ['before', 1234], ['after', 1234],
  ]);
});

it('skips the timing resolver when there is no visual feedback subscriber', async () => {
  const element = document.createElement('button');
  const delay = vi.fn(() => 900);
  const effect = vi.fn();
  await withActionFeedback({ actionDelayMs: delay }, 'click', () => element, new AbortController().signal, effect);
  expect(delay).not.toHaveBeenCalled();
  expect(effect).toHaveBeenCalledWith(element);
});

it('revalidates the target after a timing resolver changes the page', async () => {
  const element = document.body.appendChild(document.createElement('button'));
  const effect = vi.fn();
  await expect(withActionFeedback({
    actionDelayMs: () => { element.remove(); return 100; },
    onAction: () => {},
  }, 'click', () => {
    if (!element.isConnected) throw new Error('Stale target');
    return element;
  }, new AbortController().signal, effect)).rejects.toThrow('Stale target');
  expect(effect).not.toHaveBeenCalled();
});

it('cancels a calculated travel delay before an action can run', async () => {
  vi.useFakeTimers();
  const element = document.createElement('button');
  const controller = new AbortController();
  const effect = vi.fn();
  const pending = withActionFeedback({
    actionDelayMs: () => 1500, onAction: () => {},
  }, 'click', () => element, controller.signal, effect);
  controller.abort(new Error('Cancelled'));
  await expect(pending).rejects.toThrow('Cancelled');
  await vi.advanceTimersByTimeAsync(2000);
  expect(effect).not.toHaveBeenCalled();
});

it.each([-1, NaN, Infinity, 10001, 1.5])('rejects invalid calculated timing %s before acting', async (delay) => {
  const effect = vi.fn();
  await expect(withActionFeedback({
    actionDelayMs: () => delay, onAction: () => {},
  }, 'click', () => document.createElement('button'), new AbortController().signal, effect)).rejects.toThrow(RangeError);
  expect(effect).not.toHaveBeenCalled();
});
