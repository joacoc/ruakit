// Copyright 2026 RuaKit contributors. SPDX-License-Identifier: Apache-2.0
import { RuntimeError } from './errors.js';

export function validateTimeout(value: number): void {
  if (!Number.isInteger(value) || value < 1 || value > 2147483647) {
    throw new RangeError('timeoutMs must be an integer between 1 and 2147483647.');
  }
}

/** Bound adapter work even when an adapter ignores cancellation. */
export async function withDeadline<T>(
  timeoutMs: number,
  caller: AbortSignal | undefined,
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  validateTimeout(timeoutMs);

  const controller = new AbortController();
  const cancel = (): void => controller.abort(caller?.reason);

  caller?.addEventListener('abort', cancel, { once: true });
  if (caller?.aborted) {
    cancel();
  }

  const timer = setTimeout(
    () => controller.abort(new RuntimeError('TIMEOUT', 'The operation timed out.')),
    timeoutMs,
  );
  const signal = controller.signal;

  try {
    signal.throwIfAborted();
    return await new Promise<T>((resolve, reject) => {
      const abort = (): void => reject(signal.reason);
      signal.addEventListener('abort', abort, { once: true });
      Promise.resolve()
        .then(() => {
          signal.throwIfAborted();
          return operation(signal);
        })
        .then(resolve, reject)
        .finally(() => signal.removeEventListener('abort', abort));
    });
  } finally {
    clearTimeout(timer);
    caller?.removeEventListener('abort', cancel);
  }
}

export function pause(signal: AbortSignal, milliseconds = 0): Promise<void> {
  signal.throwIfAborted();

  return new Promise((resolve, reject) => {
    const abort = (): void => {
      clearTimeout(timer);
      reject(signal.reason);
    };

    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, milliseconds);

    signal.addEventListener('abort', abort, { once: true });
  });
}
