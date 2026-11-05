// Copyright 2026 RuaKit contributors. SPDX-License-Identifier: Apache-2.0
import { RuntimeError } from './errors.js';
import type { Screenshot } from './types.js';

const privateSelector =
  'input[type="password"], input[type="file"], [data-ruakit-ignore], [data-ruakit-toolbar]';
const maxDimension = 8192;
const maxPixels = 4 * 1024 * 1024;
const maxBytes = 5 * 1024 * 1024;
const pngPrefix = 'data:image/png;base64,';

function excluded(element: Element): boolean {
  let ancestor: Element | null = element;
  while (ancestor) {
    if (ancestor.closest(privateSelector)) return true;

    const scope = ancestor.getRootNode();
    ancestor = 'host' in scope ? (scope as ShadowRoot).host : null;
  }

  if (['SCRIPT', 'NOSCRIPT', 'HEAD', 'IFRAME'].includes(element.tagName.toUpperCase())) {
    return true;
  }

  // SVGs and <use> references bypass html-to-image's child filter.
  return (
    element.namespaceURI === 'http://www.w3.org/2000/svg' &&
    Boolean(element.querySelector(privateSelector) || element.querySelector('use'))
  );
}

function pngData(canvas: HTMLCanvasElement, signal: AbortSignal): string {
  const dataUrl = canvas.toDataURL('image/png');
  signal.throwIfAborted();

  const data = dataUrl.slice(pngPrefix.length);
  if (
    !dataUrl.startsWith(pngPrefix) ||
    !data.length ||
    data.length % 4 !== 0 ||
    data.length > Math.ceil(maxBytes / 3) * 4 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(data)
  ) {
    throw new RuntimeError('UNSUPPORTED', 'The screenshot must be a PNG image within 5 MiB.');
  }

  const bytes = globalThis.atob(data);
  if (bytes.length > maxBytes || !bytes.startsWith('\x89PNG\r\n\x1a\n')) {
    throw new RuntimeError('UNSUPPORTED', 'The screenshot must be a PNG image within 5 MiB.');
  }

  return data;
}

export async function captureScreenshot(
  root: Document | HTMLElement,
  signal: AbortSignal,
): Promise<Screenshot> {
  signal.throwIfAborted();

  const document = root.ownerDocument ?? (root as Document);
  const element =
    root.nodeType === 9 ? document.documentElement : (root as HTMLElement);
  const url = document.URL;

  if (!element?.isConnected) {
    throw new RuntimeError(
      'STALE_TARGET',
      'The screenshot root is disconnected.',
    );
  }
  if (excluded(element)) {
    throw new RuntimeError(
      'UNSUPPORTED',
      'The screenshot root is excluded from observation.',
    );
  }

  const rect = element.getBoundingClientRect();
  const width = Math.ceil(
    Math.max(element.offsetWidth, element.clientWidth) || rect.width,
  );
  const height = Math.ceil(
    Math.max(element.offsetHeight, element.clientHeight) || rect.height,
  );

  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width < 1 ||
    height < 1
  ) {
    throw new RuntimeError(
      'UNSUPPORTED',
      'The screenshot root has no rendered area.',
    );
  }

  const scale = Math.min(
    1,
    maxDimension / width,
    maxDimension / height,
    Math.sqrt(maxPixels / width / height),
  );
  const style = document.defaultView?.getComputedStyle(element);

  // Import only on demand. Observation, actions and server rendering do not load the renderer.
  const { toCanvas } = await import('html-to-image');
  signal.throwIfAborted();

  const canvas = await toCanvas(element, {
    width,
    height,
    canvasWidth: Math.max(1, Math.floor(width * scale)),
    canvasHeight: Math.max(1, Math.floor(height * scale)),
    pixelRatio: 1,
    includeQueryParams: true,
    fetchRequestInit: { signal },
    // Normalize the root's placement in the exported image without changing the live page.
    style: {
      margin: '0',
      top: '0',
      left: '0',
      transform: 'none',
      width: style?.width || `${width}px`,
      height: style?.height || `${height}px`,
    },
    filter: (node) => {
      signal.throwIfAborted();
      return node.nodeType !== 1 || !excluded(node);
    },
  });

  signal.throwIfAborted();
  if (document.URL !== url || !element.isConnected) {
    throw new RuntimeError(
      'STALE_TARGET',
      'The page changed during screenshot capture.',
    );
  }
  if (excluded(element)) {
    throw new RuntimeError(
      'STALE_TARGET',
      'The screenshot root became excluded during capture.',
    );
  }

  if (
    !Number.isInteger(canvas.width) ||
    canvas.width < 1 ||
    canvas.width > maxDimension ||
    !Number.isInteger(canvas.height) ||
    canvas.height < 1 ||
    canvas.height > maxDimension ||
    canvas.width * canvas.height > maxPixels
  ) {
    throw new RuntimeError(
      'UNSUPPORTED',
      'The screenshot exceeds the image dimensions limit.',
    );
  }
  const data = pngData(canvas, signal);

  return {
    data,
    mimeType: 'image/png',
    width: canvas.width,
    height: canvas.height,
    capturedAt: Date.now(),
    url,
  };
}
