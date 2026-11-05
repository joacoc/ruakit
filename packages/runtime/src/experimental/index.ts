// Copyright 2026 RuaKit contributors. SPDX-License-Identifier: MIT
import { pause, withDeadline } from '../operations.js';
import { RuntimeError } from '../errors.js';
import type { ActionOptions } from '../types.js';

/** CSS pixels relative to the surface's bounding rectangle, not canvas bitmap pixels. */
export interface Point {
  x: number;
  y: number;
}

export interface DragOptions extends ActionOptions {
  steps?: number;
  durationMs?: number;
}

export interface Pointer {
  move(point: Point, options?: ActionOptions): Promise<void>;
  down(point: Point, options?: ActionOptions): Promise<void>;
  up(point: Point, options?: ActionOptions): Promise<void>;
  drag(from: Point, to: Point, options?: DragOptions): Promise<void>;
  cancel(options?: ActionOptions): Promise<void>;
}

/**
 * Experimental synthetic mouse pointer bound to one surface (including a plain canvas).
 * Events always target this element; this does not implement hit testing, native pointer
 * capture, hover boundaries, browser default actions, or movement of the system cursor.
 */
export function createPointer(surface: HTMLElement): Pointer {
  const view = surface.ownerDocument.defaultView;
  if (!view || !view.PointerEvent) {
    throw new TypeError('createPointer requires a browser with PointerEvent support.');
  }

  let pressed = false;
  let busy = false;
  let position: Point = { x: 0, y: 0 };

  function validate(point: Point): void {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      throw new TypeError('Pointer coordinates must be finite numbers.');
    }
  }

  function emit(type: string, point: Point): void {
    position = { ...point };

    const rect = surface.getBoundingClientRect();
    const init: PointerEventInit = {
      bubbles: true,
      cancelable: true,
      composed: true,
      clientX: rect.left + point.x,
      clientY: rect.top + point.y,
      pointerId: 1,
      pointerType: 'mouse',
      isPrimary: true,
      button: type === 'pointermove' || type === 'pointercancel' ? -1 : 0,
      buttons: pressed ? 1 : 0,
      pressure: pressed ? 0.5 : 0,
    };

    const accepted = surface.dispatchEvent(new view!.PointerEvent(type, init));

    // Mouse compatibility events are explicit: dispatchEvent does not generate them.
    if (accepted && type !== 'pointercancel') {
      surface.dispatchEvent(
        new view!.MouseEvent(type.replace('pointer', 'mouse'), {
          ...init,
          button: 0,
        }),
      );
    }
  }

  function release(): void {
    if (pressed) {
      pressed = false;
      emit('pointercancel', position);
    }
  }

  async function run(
    options: ActionOptions,
    work: (signal: AbortSignal) => Promise<void>,
  ): Promise<void> {
    if (busy) {
      throw new RuntimeError('BUSY', 'Another pointer operation is running.');
    }

    busy = true;
    try {
      await withDeadline(options.timeoutMs ?? 2000, options.signal, async (signal) => {
        if (!surface.isConnected) {
          throw new RuntimeError('STALE_TARGET', 'The pointer surface is disconnected.');
        }

        await work(signal);
        await pause(signal);
      });
    } catch (error) {
      release();
      throw error;
    } finally {
      busy = false;
    }
  }

  return {
    move(point, options = {}) {
      validate(point);

      return run(options, async () => {
        emit('pointermove', point);
      });
    },
    down(point, options = {}) {
      validate(point);

      return run(options, async () => {
        if (pressed) {
          throw new Error('The pointer button is already down.');
        }

        pressed = true;
        emit('pointerdown', point);
      });
    },
    up(point, options = {}) {
      validate(point);

      return run(options, async () => {
        if (!pressed) {
          throw new Error('The pointer button is not down.');
        }

        pressed = false;
        emit('pointerup', point);
      });
    },
    drag(from, to, options = {}) {
      validate(from);
      validate(to);

      const steps = options.steps ?? 12;
      const duration = options.durationMs ?? 200;

      if (
        !Number.isInteger(steps) ||
        steps < 1 ||
        steps > 10000 ||
        !Number.isFinite(duration) ||
        duration < 0
      ) {
        throw new RangeError('Use 1–10000 integer steps and a finite, nonnegative durationMs.');
      }

      return run(options, async (signal) => {
        if (pressed) {
          throw new Error('Release the pointer button before dragging.');
        }

        emit('pointermove', from);
        pressed = true;
        emit('pointerdown', from);

        for (let step = 1; step <= steps; step++) {
          await pause(signal, duration / steps);
          signal.throwIfAborted();

          if (!surface.isConnected) {
            throw new RuntimeError('STALE_TARGET', 'The pointer surface is disconnected.');
          }

          emit('pointermove', {
            x: from.x + ((to.x - from.x) * step) / steps,
            y: from.y + ((to.y - from.y) * step) / steps,
          });
        }

        pressed = false;
        emit('pointerup', to);
      });
    },
    cancel(options = {}) {
      return run(options, async () => {
        release();
      });
    },
  };
}
