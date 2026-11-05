// Copyright 2026 RuaKit contributors. SPDX-License-Identifier: MIT
import { pause } from './operations.js';
import type {
  ActionFeedbackOptions,
  ActionRect,
  RuntimeAction,
  RuntimeActionEvent,
} from './types.js';

let nextAction = 0;

/** Present one validated local action. The resolver must reject stale or unavailable targets. */
export async function withActionFeedback<T>(
  options: ActionFeedbackOptions,
  action: RuntimeAction,
  resolve: () => HTMLElement,
  signal: AbortSignal,
  effect: (element: HTMLElement) => T | Promise<T>,
): Promise<T> {
  signal.throwIfAborted();

  const delay = options.actionDelayMs ?? 0;
  const validateDelay = (value: number): number => {
    if (!Number.isInteger(value) || value < 0 || value > 10000)
      throw new RangeError('actionDelayMs must resolve to an integer from 0 to 10000 milliseconds.');
    return value;
  };

  let durationMs = typeof delay === 'function' ? 0 : validateDelay(delay);
  let element = resolve();

  if (!options.onAction) {
    return effect(element);
  }

  const id = ++nextAction;
  let rect: ActionRect = { left: 0, top: 0, width: 0, height: 0 };

  const notify = (phase: RuntimeActionEvent['phase']): void => {
    if (element.isConnected) {
      const bounds = element.getBoundingClientRect();
      rect = { left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height };
    }

    try {
      options.onAction?.({ id, action, phase, element, rect: { ...rect }, durationMs });
    } catch {
      // UI feedback cannot authorize an action or invalidate its result.
    }
  };

  try {
    if (options.scrollToTarget) {
      element.scrollIntoView?.({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
    }

    signal.throwIfAborted();
    element = resolve();

    if (typeof delay === 'function') {
      durationMs = validateDelay(delay(element));
      signal.throwIfAborted();
      element = resolve();
    }

    notify('before');
    signal.throwIfAborted();
    if (durationMs) {
      await pause(signal, durationMs);
    }

    // Scrolling, UI callbacks and animation time can all change the application.
    element = resolve();
    signal.throwIfAborted();

    const result = await effect(element);
    signal.throwIfAborted();
    notify('after');

    return result;
  } catch (error) {
    notify(signal.aborted ? 'cancelled' : 'failed');
    throw error;
  }
}
