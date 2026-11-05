// Copyright 2026 RuaKit contributors. SPDX-License-Identifier: MIT
// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createRuntime } from '../src/index.js';
import type { Runtime, Target } from '../src/index.js';

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(
    () => [new DOMRect(0, 0, 10, 10)] as unknown as DOMRectList,
  );
  window.history.replaceState({}, '', '/');
});

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

function target(runtime: Runtime, label: string): Target {
  const control = runtime.getState().controls.find((item) => item.label === label);
  if (!control) {
    throw new Error(`Missing control: ${label}`);
  }
  return control.target;
}

it.each([undefined, false, true])('only scrolls feedback targets when enabled (%s)', async (scrollToTarget) => {
  const input = document.body.appendChild(document.createElement('input'));
  input.setAttribute('aria-label', 'Name');
  const scroll = vi.fn();
  input.scrollIntoView = scroll;
  const focus = vi.spyOn(input, 'focus');
  const events: string[] = [];
  const runtime = createRuntime({
    ...(scrollToTarget === undefined ? {} : { scrollToTarget }),
    onAction: (event) => events.push(event.phase),
  });
  await runtime.setValue(target(runtime, 'Name'), 'Ana');
  expect(input.value).toBe('Ana');
  expect(events).toEqual(['before', 'after']);
  expect(focus).toHaveBeenCalledWith({ preventScroll: true });
  if (scrollToTarget) {
    expect(scroll).toHaveBeenCalledExactlyOnceWith({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
  } else {
    expect(scroll).not.toHaveBeenCalled();
  }
});

it('observes, focuses and edits controls in nested open shadow trees within the app root', async () => {
  document.body.innerHTML = '<main><section role="group" aria-label="Code editor"><div id="host"></div></section></main><div id="outside"></div>';
  const host = document.querySelector<HTMLElement>('#host')!;
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = '<div id="nested"></div>';
  const nested = shadow.querySelector('#nested')!.attachShadow({ mode: 'open' });
  nested.innerHTML = '<textarea aria-label="Source code">initial</textarea>';
  document.querySelector('#outside')!.attachShadow({ mode: 'open' }).innerHTML = '<button>Outside</button>';
  const runtime = createRuntime({ root: document.querySelector('main')! });
  const state = runtime.getState();
  expect(state.controls).toMatchObject([{
    label: 'Source code', value: 'initial', groups: [{ role: 'group', name: 'Code editor' }],
  }]);
  const focused = await runtime.focus(state.controls[0]!.target);
  expect(focused.focused).toEqual(focused.controls[0]!.target);
  const updated = await runtime.setValue(focused.controls[0]!.target, 'changed');
  expect(updated.controls[0]?.value).toBe('changed');
  host.remove();
  await expect(runtime.click(updated.controls[0]!.target)).rejects.toMatchObject({ code: 'STALE_TARGET' });
});

it.each(['hidden', 'data-ruakit-ignore', 'inert', 'aria-hidden', 'style'])(
  'excludes shadow controls when their host becomes %s', async (attribute) => {
    const host = document.createElement('div');
    document.body.append(host);
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = '<button>Shadow action</button><input type="password" value="secret">';
    const runtime = createRuntime();
    const reference = target(runtime, 'Shadow action');
    host.setAttribute(attribute, attribute === 'style' ? 'display:none' : attribute === 'aria-hidden' ? 'true' : '');
    await expect(runtime.click(reference)).rejects.toMatchObject({ code: 'STALE_TARGET' });
    expect(runtime.getState().controls).toEqual([]);
  },
);

it('lets rich editors handle insertion through beforeinput without also running the browser command', async () => {
  const host = document.body.appendChild(document.createElement('div'));
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = '<div contenteditable="true" aria-label="Source code">initial</div>';
  const editor = shadow.querySelector('div')!;
  editor.addEventListener('beforeinput', (event) => {
    event.preventDefault();
    editor.textContent += (event as InputEvent).data;
  });
  const command = vi.fn();
  Object.defineProperty(document, 'execCommand', { configurable: true, value: command });
  try {
    const runtime = createRuntime();
    const updated = await runtime.insertText(target(runtime, 'Source code'), ' changed');
    expect(updated.controls[0]?.value).toBe('initial changed');
    expect(command).not.toHaveBeenCalled();
  } finally {
    Reflect.deleteProperty(document, 'execCommand');
  }
});

it('reports rejected insertion when an editor prevents beforeinput without accepting the text', async () => {
  document.body.innerHTML = '<div contenteditable="true" aria-label="Source code">initial</div>';
  document.querySelector('div')!.addEventListener('beforeinput', (event) => event.preventDefault());
  const runtime = createRuntime();
  await expect(runtime.insertText(target(runtime, 'Source code'), ' changed')).rejects.toMatchObject({ code: 'VALUE_REJECTED' });
});

it('observes the rendered app without a map, and keeps field values out of labels and page prose', () => {
  document.body.innerHTML = `<h1>Editor</h1><label>Source code<textarea>SELECT 1</textarea></label>
    <button disabled>Run</button><input type="submit" value="Save">
    <div hidden><button>Hidden</button>Hidden text</div>
    <div style="display:none">CSS hidden</div><script>secretScript()</script>
    <input type="password" tabindex="0" value="secret"><input type="file" role="button">
    <div data-ruakit-ignore><button>Ignored</button>Ignored text</div>`;
  const state = createRuntime().getState();
  expect(state.controls.map((control) => control.label)).toEqual(['Source code', 'Run', 'Save']);
  expect(state.controls[0]).toMatchObject({ value: 'SELECT 1', role: 'textbox' });
  expect(state.controls[1]?.enabled).toBe(false);
  expect(state.text).toBe('Editor Source code Run');
  expect(JSON.stringify(state)).not.toMatch(/secret|Hidden text|CSS hidden|Ignored text/);
  expect(JSON.parse(JSON.stringify(state))).toEqual(state);
});

it('computes accessible names from hidden ARIA references, native labels and image alternatives', () => {
  document.body.innerHTML = `<span id="action" hidden>Run</span><span id="kind">SQL</span>
    <button aria-labelledby="action kind" aria-label="Fallback">Visible caption</button>
    <label>Native caption<input aria-label="Preferred name"></label>
    <label for="query">Source code</label><textarea id="query">SELECT 1</textarea>
    <button><img alt="Export results"></button><input type="image" alt="Upload query">`;
  const state = createRuntime().getState();
  expect(state.controls.map((control) => control.label)).toEqual([
    'Run SQL',
    'Preferred name',
    'Source code',
    'Export results',
    'Upload query',
  ]);
  expect(state.text).not.toContain('Run');
  expect(state.text).not.toContain('SELECT 1');
});

it('keeps empty accessible names and reports placeholders and descriptions separately', () => {
  document.body.innerHTML = `<span id="empty"></span>
    <button aria-labelledby="empty" aria-label="Fallback">Visible caption</button>
    <input placeholder="Search invoices">
    <span id="help" hidden>Enter a SQL query</span>
    <textarea title="SQL editor" placeholder="SELECT 1" aria-describedby="help"
      aria-description="Fallback description"></textarea>
    <div contenteditable="true" role="textbox">Draft text</div>`;
  const state = createRuntime().getState();
  expect(state.controls).toMatchObject([
    { label: '' },
    { label: '', placeholder: 'Search invoices' },
    { label: 'SQL editor', description: 'Enter a SQL query', placeholder: 'SELECT 1' },
    { label: '', value: 'Draft text' },
  ]);
});

it('resolves accessible names outside the app container without adding outside controls', () => {
  document.body.innerHTML = `<label for="query">SQL query</label><button>Outside</button>
    <main><textarea id="query"></textarea></main>`;
  const state = createRuntime({ root: document.querySelector('main')! }).getState();
  expect(state.controls).toMatchObject([{ label: 'SQL query' }]);
  expect(state.controls).toHaveLength(1);
  expect(state.text).toBe('');
});

it.each(['name', 'description', 'placeholder'])(
  'rejects a target when its observed accessible %s changes',
  async (change) => {
    document.body.innerHTML = `<span id="name" hidden>Query</span>
      <span id="help" hidden>Write a query</span>
      <textarea aria-labelledby="name" aria-describedby="help" placeholder="SELECT 1"></textarea>`;
    const runtime = createRuntime();
    const reference = target(runtime, 'Query');
    if (change === 'name') {
      document.getElementById('name')!.textContent = 'Different query';
    } else if (change === 'description') {
      document.getElementById('help')!.textContent = 'Different guidance';
    } else {
      document.querySelector('textarea')!.placeholder = 'SELECT 2';
    }
    await expect(runtime.setValue(reference, 'SELECT 42')).rejects.toMatchObject({
      code: 'STALE_TARGET',
    });
    expect(document.querySelector('textarea')!.value).toBe('');
  },
);

it.each(['aria-label', 'aria-description', 'placeholder'])(
  'bounds %s text and marks the observation as truncated',
  (attribute) => {
    document.body.innerHTML = '<input>';
    document.querySelector('input')!.setAttribute(attribute, 'x'.repeat(1001));
    const state = createRuntime().getState();
    const property = {
      'aria-label': 'label',
      'aria-description': 'description',
      placeholder: 'placeholder',
    } as const;
    expect(state.controls[0]).toHaveProperty(
      property[attribute as keyof typeof property],
      'x'.repeat(1000),
    );
    expect(state.truncated).toBe(true);
  },
);

it('limits observation and actions to the supplied container', async () => {
  document.body.innerHTML = '<button>Outside</button><main><button>Inside</button></main>';
  const runtime = createRuntime({ root: document.querySelector('main')! });
  const outside = createRuntime();
  expect(runtime.getState().text).toBe('Inside');
  const click = vi.fn();
  document.querySelector('button')!.addEventListener('click', click);
  await expect(runtime.click(target(outside, 'Outside'))).rejects.toMatchObject({
    code: 'STALE_TARGET',
  });
  expect(click).not.toHaveBeenCalled();
});

it('reports a missing app container instead of observing the whole document', () => {
  expect(() => Reflect.apply(createRuntime, undefined, [{ root: null }])).toThrow(
    'Create the runtime in a browser, after the app has mounted.',
  );
});

it('includes a visible child that overrides hidden visibility, without including hidden ancestor text', () => {
  document.body.innerHTML =
    '<main style="visibility:hidden">Hidden text<button style="visibility:visible">Visible</button></main>';
  const runtime = createRuntime({ root: document.querySelector('main')! });
  expect(runtime.getState()).toMatchObject({ text: 'Visible', controls: [{ label: 'Visible' }] });
});

it('keeps observed state isolated from changes made by callers', async () => {
  document.body.innerHTML = '<button autofocus>Open</button>';
  document.querySelector('button')!.focus();
  const runtime = createRuntime();
  const state = runtime.getState();
  state.focused!.version = 999;
  state.controls[0]!.label = 'Changed by caller';
  await expect(runtime.click(state.controls[0]!.target)).resolves.toMatchObject({ text: 'Open' });
});

it.each(['replace', 'row', 'route', 'constraints'])(
  'rejects a target after a change to its %s evidence',
  async (change) => {
    document.body.innerHTML =
      '<article>Invoice 100<label>Code<input></label><button>Open</button></article>';
    const runtime = createRuntime();
    const reference = target(runtime, 'Code');
    const input = document.querySelector('input')!;
    if (change === 'replace') {
      input.replaceWith(input.cloneNode());
    }
    if (change === 'row') {
      document.querySelector('article')!.firstChild!.textContent = 'Invoice 200';
    }
    if (change === 'route') {
      window.history.pushState({}, '', '/other');
    }
    if (change === 'constraints') {
      input.maxLength = 1;
    }
    await expect(runtime.setValue(reference, 'SELECT 100')).rejects.toMatchObject({
      code: 'STALE_TARGET',
    });
    expect(input.value).toBe('');
  },
);

it('preserves unchanged references between observations, but expires a removed target', async () => {
  document.body.innerHTML = '<button>Open</button>';
  const runtime = createRuntime();
  const button = document.querySelector('button')!;
  const old = target(runtime, 'Open');
  expect(target(runtime, 'Open')).toEqual(old);
  button.remove();
  runtime.getState();
  document.body.append(button);
  expect(target(runtime, 'Open').version).not.toBe(old.version);
  await expect(runtime.click(old)).rejects.toMatchObject({ code: 'STALE_TARGET' });
});

it('fills a field, sends input/change events and reads the accepted value', async () => {
  document.body.innerHTML = '<label>Code<textarea></textarea></label><button>Save</button>';
  const runtime = createRuntime();
  const input = vi.fn();
  const change = vi.fn();
  document.querySelector('textarea')!.addEventListener('input', input);
  document.querySelector('textarea')!.addEventListener('change', change);
  const state = await runtime.setValue(target(runtime, 'Code'), 'SELECT 100');
  expect(state.controls[0]?.value).toBe('SELECT 100');
  expect(state.focused).toEqual(state.controls[0]?.target);
  expect(input).toHaveBeenCalledOnce();
  expect(change).toHaveBeenCalledOnce();
  await runtime.blur(state.controls[0]!.target);
  expect(runtime.getState().focused).toBeNull();
});

it('leaves native validation available without preventing an incomplete edit', async () => {
  document.body.innerHTML = '<label>Email<input type="email" required></label>';
  const runtime = createRuntime();
  const state = await runtime.setValue(target(runtime, 'Email'), 'unfinished');
  expect(state.controls[0]).toMatchObject({ value: 'unfinished', valid: false });
});

it.each(['disabled', 'read-only', 'rejected', 'detached', 'focus-change'] as const)(
  'reports a %s field without claiming a successful write',
  async (kind) => {
    document.body.innerHTML = '<label>Code<textarea></textarea></label>';
    const field = document.querySelector('textarea')!;
    if (kind === 'disabled') {
      field.disabled = true;
    }
    if (kind === 'read-only') {
      field.readOnly = true;
    }
    if (kind === 'rejected') {
      field.addEventListener('input', () => {
        field.value = 'Original';
      });
    }
    if (kind === 'detached') {
      field.addEventListener('input', () => field.remove());
    }
    if (kind === 'focus-change') {
      field.addEventListener('focus', () => {
        field.readOnly = true;
      });
    }
    const runtime = createRuntime();
    const codes = {
      disabled: 'DISABLED',
      'read-only': 'READ_ONLY',
      rejected: 'VALUE_REJECTED',
      detached: 'VALUE_REJECTED',
      'focus-change': 'STALE_TARGET',
    };
    await expect(runtime.setValue(target(runtime, 'Code'), 'SELECT 100')).rejects.toMatchObject({
      code: codes[kind],
    });
    if (['disabled', 'read-only', 'focus-change'].includes(kind)) {
      expect(field.value).toBe('');
    }
  },
);

it('selects explicit values and uses native checkbox/radio behavior without submitting', async () => {
  document.body.innerHTML = `<form><label>Country<select><option value="AR">Argentina</option><option value="DE">Germany</option></select></label>
    <label>Updates<input type="checkbox"></label>
    <label>Email<input type="radio" name="contact" checked></label><label>Phone<input type="radio" name="contact"></label></form>`;
  const submit = vi.fn((event: Event) => event.preventDefault());
  document.querySelector('form')!.addEventListener('submit', submit);
  const runtime = createRuntime();
  const initial = runtime.getState();
  await runtime.selectOption(initial.controls[0]!.target, ['DE']);
  // An unchanged field reference remains usable after editing a different field.
  await runtime.setChecked(initial.controls[1]!.target, true);
  const state = await runtime.setChecked(target(runtime, 'Phone'), true);
  expect(state.controls.map((control) => control.checked)).toEqual([undefined, true, false, true]);
  expect(state.controls[0]?.selectedValues).toEqual(['DE']);
  expect(submit).not.toHaveBeenCalled();
});

it.each([['missing'], ['DE'], ['AR', 'AR'], ['AR', 'DE']])(
  'rejects unavailable select values: %s',
  async (...values) => {
    document.body.innerHTML =
      '<label>Country<select><option value="AR">Argentina</option><optgroup disabled><option value="DE">Germany</option></optgroup></select></label>';
    const runtime = createRuntime();
    await expect(runtime.selectOption(target(runtime, 'Country'), values)).rejects.toMatchObject({
      code: 'UNSUPPORTED',
    });
    expect(document.querySelector('select')!.value).toBe('AR');
  },
);

it('supports multiple selections and clearing a selection', async () => {
  document.body.innerHTML =
    '<label>Services<select multiple><option value="api">API</option><option value="auth">Auth</option></select></label>';
  const runtime = createRuntime();
  const selected = await runtime.selectOption(target(runtime, 'Services'), ['api', 'auth']);
  expect(selected.controls[0]?.selectedValues).toEqual(['api', 'auth']);
  expect(
    (await runtime.selectOption(selected.controls[0]!.target, [])).controls[0]?.selectedValues,
  ).toEqual([]);
});

it('dispatches keyboard events with modifiers to the focused control', async () => {
  document.body.innerHTML = '<label>Code<textarea></textarea></label>';
  const keydown = vi.fn();
  document.querySelector('textarea')!.addEventListener('keydown', keydown);
  const runtime = createRuntime();
  const state = await runtime.pressKey(target(runtime, 'Code'), 'Enter', { ctrlKey: true });
  expect(keydown.mock.calls[0]?.[0]).toMatchObject({ key: 'Enter', ctrlKey: true });
  expect(state.controls[0]?.value).toBe('');
});

it('clicks and returns a fresh observation of the resulting page', async () => {
  document.body.innerHTML = '<button>Open</button>';
  document.querySelector('button')!.addEventListener('click', () => {
    document.body.innerHTML = '<h1>Details</h1>';
  });
  const runtime = createRuntime();
  expect((await runtime.click(target(runtime, 'Open'))).text).toBe('Details');
});

it('waits for asynchronous changes, then releases ownership on timeout and cancellation', async () => {
  const runtime = createRuntime({ timeoutMs: 100 });
  const pending = runtime.waitFor((state) => state.text === 'Ready');
  await expect(runtime.waitFor(() => true)).rejects.toMatchObject({ code: 'BUSY' });
  document.body.textContent = 'Ready';
  expect((await pending).text).toBe('Ready');
  await expect(runtime.waitFor(() => false, { timeoutMs: 10 })).rejects.toMatchObject({
    code: 'TIMEOUT',
  });
  const controller = new AbortController();
  const cancelled = runtime.waitFor(() => false, { signal: controller.signal });
  controller.abort(new Error('Stopped'));
  await expect(cancelled).rejects.toThrow('Stopped');
  await expect(runtime.waitFor(() => true)).resolves.toMatchObject({ text: 'Ready' });
});

it('honors cancellation from focus before changing a value', async () => {
  document.body.innerHTML = '<label>Code<textarea></textarea></label>';
  const controller = new AbortController();
  document
    .querySelector('textarea')!
    .addEventListener('focus', () => controller.abort(new Error('Stopped')));
  const runtime = createRuntime();
  await expect(
    runtime.setValue(target(runtime, 'Code'), 'SELECT 100', { signal: controller.signal }),
  ).rejects.toThrow('Stopped');
  expect(document.querySelector('textarea')!.value).toBe('');
});

it('navigates through a callback and rejects unsupported or uncommitted navigation', async () => {
  const navigate = vi.fn((path: string) => window.history.pushState({}, '', path));
  const runtime = createRuntime({ navigate });
  expect((await runtime.goto('/editor?draft=1#code')).url).toBe(
    `${window.location.origin}/editor?draft=1#code`,
  );
  await expect(runtime.goto('https://another.example/')).rejects.toMatchObject({
    code: 'UNSUPPORTED',
  });
  expect(navigate).toHaveBeenCalledOnce();
  await expect(createRuntime().goto('/editor')).rejects.toMatchObject({ code: 'UNSUPPORTED' });
  await expect(createRuntime({ navigate: () => {} }).goto('/other')).rejects.toMatchObject({
    code: 'VALUE_REJECTED',
  });
});

it('bounds navigation adapters that ignore cancellation', async () => {
  let reject!: (error: Error) => void;
  const runtime = createRuntime({
    navigate: () =>
      new Promise<void>((_resolve, fail) => {
        reject = fail;
      }),
  });
  await expect(runtime.goto('/other', { timeoutMs: 10 })).rejects.toMatchObject({
    code: 'TIMEOUT',
  });
  reject(new Error('Late adapter failure'));
  await expect(runtime.waitFor(() => true)).resolves.toBeDefined();
});

it('marks bounded observations as truncated', () => {
  document.body.textContent = 'x'.repeat(20001);
  expect(createRuntime().getState()).toMatchObject({ text: 'x'.repeat(20000), truncated: true });
});

it('observes contenteditable editors and inserts through the browser command instead of changing their DOM directly', async () => {
  document.body.innerHTML =
    '<div class="cm-editor"><div class="cm-content" contenteditable="true" role="textbox" aria-label="SQL">SELECT 1</div></div>';
  const runtime = createRuntime();
  const editor = runtime.getState().controls[0]!;
  expect(editor).toMatchObject({ contentEditable: true, value: 'SELECT 1' });
  const command = vi.fn(() => true);
  Object.defineProperty(document, 'execCommand', { configurable: true, value: command });
  try {
    await runtime.insertText(editor.target, 'SELECT 42');
    expect(command).toHaveBeenCalledWith('insertText', false, 'SELECT 42');
    expect(document.activeElement).toBe(document.querySelector('.cm-content'));
    // The browser/editor owns the mutation, not a textContent assignment in RuaKit.
    expect(document.querySelector('.cm-content')!.textContent).toBe('SELECT 1');
    command.mockReturnValue(false);
    await expect(
      runtime.insertText(runtime.getState().controls[0]!.target, 'x'),
    ).rejects.toMatchObject({ code: 'VALUE_REJECTED' });
  } finally {
    Reflect.deleteProperty(document, 'execCommand');
  }
});
