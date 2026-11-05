// Copyright 2026 RuaKit contributors. SPDX-License-Identifier: MIT

export interface RequestOperation {
  signal: AbortSignal;
  dispose(): void;
}

export function validateRequestTimeout(timeoutMs: number): void {
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 2147483647) {
    throw new RangeError(
      'RuaKit request timeout must be an integer from 1 to 2147483647 milliseconds.',
    );
  }
}

/** Own the deadline and caller subscription until this request settles. */
export function createRequestOperation(
  timeoutMs: number,
  callerSignal?: AbortSignal,
): RequestOperation {
  validateRequestTimeout(timeoutMs);
  const controller = new AbortController();
  const cancel = (): void => controller.abort(callerSignal?.reason);
  callerSignal?.addEventListener('abort', cancel, { once: true });
  if (callerSignal?.aborted) {
    cancel();
  }
  const timer = setTimeout(() => {
    controller.abort(new DOMException('The operation was aborted due to timeout', 'TimeoutError'));
  }, timeoutMs);
  return {
    signal: controller.signal,
    dispose() {
      clearTimeout(timer);
      callerSignal?.removeEventListener('abort', cancel);
    },
  };
}

/** Stop awaiting an adapter that ignores cancellation; its late result is discarded. */
export async function runWithSignal<Value>(
  signal: AbortSignal,
  operation: () => Value | Promise<Value>,
): Promise<Value> {
  signal.throwIfAborted();
  return new Promise<Value>((resolve, reject) => {
    const cleanup = (): void => signal.removeEventListener('abort', cancel);
    const cancel = (): void => {
      cleanup();
      reject(signal.reason);
    };
    signal.addEventListener('abort', cancel, { once: true });
    // Attach both settlement handlers even after cancellation so a late rejection
    // from a custom adapter cannot become an unhandled rejection.
    Promise.resolve()
      .then(() => {
        signal.throwIfAborted();
        return operation();
      })
      .then(
        (value) => {
          cleanup();
          resolve(value);
        },
        (error: unknown) => {
          cleanup();
          reject(error);
        },
      );
  });
}
