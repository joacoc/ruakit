// Copyright 2026 RuaKit contributors. SPDX-License-Identifier: Apache-2.0
// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { toCanvas } from 'html-to-image';
import { createRuntime } from '../src/index.js';

vi.mock('html-to-image', () => ({ toCanvas: vi.fn() }));

const png =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aG7cAAAAASUVORK5CYII=';
let canvas: HTMLCanvasElement;
beforeEach(() => {
  vi.mocked(toCanvas).mockReset();
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(600);
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(400);
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([
    new DOMRect(10, 20, 600, 400),
  ] as unknown as DOMRectList);
  canvas = document.createElement('canvas');
  canvas.width = 600;
  canvas.height = 400;
  vi.spyOn(canvas, 'toDataURL').mockReturnValue(`data:image/png;base64,${png}`);
  vi.mocked(toCanvas).mockResolvedValue(canvas);
});
afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it('renders the configured root on demand without a host adapter', async () => {
  document.body.innerHTML = '<main><button>Save</button></main>';
  const root = document.querySelector('main')!;
  const runtime = createRuntime({ root });
  runtime.getState();
  expect(toCanvas).not.toHaveBeenCalled();
  await expect(runtime.screenshot()).resolves.toEqual({
    data: png,
    mimeType: 'image/png',
    width: 600,
    height: 400,
    url: document.URL,
    capturedAt: expect.any(Number),
  });
  expect(toCanvas).toHaveBeenCalledWith(
    root,
    expect.objectContaining({
      pixelRatio: 1,
      includeQueryParams: true,
      fetchRequestInit: { signal: expect.any(AbortSignal) },
    }),
  );
});

it('uses the document element by default and excludes private content before rendering', async () => {
  document.body.innerHTML = `
    <input type="password" value="Secret"><input type="file">
    <div data-ruakit-ignore><span>Private</span></div>
    <aside data-ruakit-toolbar>Rua</aside><iframe></iframe>
    <svg><text data-ruakit-ignore>Private SVG</text></svg>
    <svg><use href="#external-symbol"></use></svg>
    <svg id="chart"><rect width="100" height="100"></rect></svg>
    <button>Save</button>`;
  await createRuntime().screenshot();
  expect(toCanvas).toHaveBeenCalledWith(
    document.documentElement,
    expect.any(Object),
  );
  const filter = vi.mocked(toCanvas).mock.calls[0]![1]!.filter!;
  for (const selector of [
    'input',
    '[data-ruakit-ignore]',
    '[data-ruakit-ignore] span',
    '[data-ruakit-toolbar]',
    'iframe',
    'svg:not(#chart)',
  ]) {
    for (const node of document.querySelectorAll<HTMLElement>(selector))
      expect(filter(node), selector).toBe(false);
  }
  expect(filter(document.querySelector('button')!)).toBe(true);
  expect(filter(document.querySelector<HTMLElement>('#chart')!)).toBe(true);
});

it('rejects excluded roots, roots inside ignored UI and roots without rendered area', async () => {
  document.body.innerHTML =
    '<main data-ruakit-ignore><div></div></main><iframe></iframe>';
  const host = document.querySelector('main')!;
  const shadow = host.attachShadow({ mode: 'open' });
  const child = document.createElement('div');
  shadow.append(child);
  for (const root of [
    host,
    document.querySelector('div')!,
    document.querySelector('iframe')!,
    child,
  ])
    await expect(createRuntime({ root }).screenshot()).rejects.toMatchObject({
      code: 'UNSUPPORTED',
    });
  document.body.replaceChildren();
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(0);
  await expect(createRuntime().screenshot()).rejects.toMatchObject({
    code: 'UNSUPPORTED',
  });
  expect(toCanvas).not.toHaveBeenCalled();
});

it('preserves the root content dimensions when its rendered box includes padding and borders', async () => {
  document.body.innerHTML =
    '<main style="width:560px;height:360px;padding:10px;border:10px solid"></main>';
  await createRuntime({ root: document.querySelector('main')! }).screenshot();
  expect(toCanvas).toHaveBeenCalledWith(
    document.querySelector('main'),
    expect.objectContaining({
      width: 600,
      height: 400,
      style: expect.objectContaining({ width: '560px', height: '360px' }),
    }),
  );
});

it('bounds output resolution before rendering large roots', async () => {
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(10000);
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(10000);
  await createRuntime().screenshot();
  expect(toCanvas).toHaveBeenCalledWith(
    document.documentElement,
    expect.objectContaining({
      width: 10000,
      height: 10000,
      canvasWidth: 2048,
      canvasHeight: 2048,
      pixelRatio: 1,
    }),
  );
});

it('rejects invalid PNG data, oversized images and invalid dimensions', async () => {
  for (const data of [
    'data:,',
    'data:image/png;base64,aGVsbG8=',
    `data:image/png;base64,${'A'.repeat(7_000_000)}`,
  ]) {
    vi.mocked(canvas.toDataURL).mockReturnValue(data);
    await expect(createRuntime().screenshot()).rejects.toMatchObject({
      code: 'UNSUPPORTED',
    });
  }
  canvas.width = 8193;
  await expect(createRuntime().screenshot()).rejects.toMatchObject({
    code: 'UNSUPPORTED',
  });
});

it('bounds an unresponsive renderer and releases operation ownership', async () => {
  vi.useFakeTimers();
  vi.mocked(toCanvas).mockReturnValueOnce(new Promise(() => {}));
  const runtime = createRuntime();
  const pending = expect(
    runtime.screenshot({ timeoutMs: 10 }),
  ).rejects.toMatchObject({
    code: 'TIMEOUT',
  });
  await expect(runtime.screenshot()).rejects.toMatchObject({ code: 'BUSY' });
  await vi.advanceTimersByTimeAsync(10);
  await pending;
  await expect(runtime.screenshot()).resolves.toMatchObject({ data: png });
  expect(vi.getTimerCount()).toBe(0);
});

it('preserves explicit cancellation, passes the abort signal to assets and discards late images', async () => {
  const controller = new AbortController();
  const reason = new Error('Stop capture');
  vi.mocked(toCanvas).mockImplementationOnce(async (_root, options) => {
    controller.abort(reason);
    expect(options!.fetchRequestInit!.signal!.aborted).toBe(true);
    return canvas;
  });
  await expect(
    createRuntime().screenshot({ signal: controller.signal }),
  ).rejects.toBe(reason);
  expect(canvas.toDataURL).not.toHaveBeenCalled();
});

it('rejects detached roots and navigation during rendering', async () => {
  const root = document.createElement('main');
  await expect(createRuntime({ root }).screenshot()).rejects.toMatchObject({
    code: 'STALE_TARGET',
  });
  document.body.append(root);
  vi.mocked(toCanvas).mockImplementationOnce(async () => {
    root.remove();
    return canvas;
  });
  await expect(createRuntime({ root }).screenshot()).rejects.toMatchObject({
    code: 'STALE_TARGET',
  });
  vi.mocked(toCanvas).mockImplementationOnce(async () => {
    window.history.replaceState(null, '', '#changed');
    return canvas;
  });
  await expect(createRuntime().screenshot()).rejects.toMatchObject({
    code: 'STALE_TARGET',
  });
  window.history.replaceState(null, '', document.URL.split('#')[0]);
});

it('propagates rendering failures without retrying capture', async () => {
  const error = new Error('Canvas is tainted');
  vi.mocked(toCanvas).mockRejectedValueOnce(error);
  await expect(createRuntime().screenshot()).rejects.toBe(error);
  expect(toCanvas).toHaveBeenCalledOnce();
});
