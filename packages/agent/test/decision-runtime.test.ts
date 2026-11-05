// Copyright 2026 RuaKit contributors. SPDX-License-Identifier: Apache-2.0
// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { CompletionCheck, Decision, DecisionRequest } from '@ruakit/schema';
import { createRuntime } from '../src/runtime.js';
import { ClarificationNeededError } from '../src/errors.js';
import type { RuaKitTransport } from '../src/transport.js';

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(
    () => [new DOMRect(0, 0, 10, 10)] as unknown as DOMRectList,
  );
});
afterEach(() => {
  document.body.replaceChildren();
  document.head.replaceChildren();
  vi.restoreAllMocks();
});
function transport(
  plan: (request: DecisionRequest) => Decision,
  checks: CompletionCheck[] = [{ type: 'text', description: 'Ready', text: 'Ready', fresh: false }],
): RuaKitTransport {
  return {
    dom: vi.fn(async (request: DecisionRequest) => {
      if (!request.checks) return { type: 'prepare' as const, message: 'Set outcomes', checks };
      const decision = plan({
        ...request,
        history: request.history.filter((item) => item.type !== 'prepare'),
      });
      return decision.type === 'complete' ? { ...decision, checks: request.checks } : decision;
    }),
  };
}
it('fills a live field and observes accepted values', async () => {
  document.body.innerHTML = '<label>Name<input /></label><p>Profile</p>';
  const provider = transport(
    (request) => {
      const control = request.snapshot.controls[0]!;
      if (!request.history.length) {
        return {
          type: 'act',
          message: 'Fill Name',
          step: { type: 'fill', target: control.target, value: 'Ada' },
        };
      }
      expect(control.value).toBe('Ada');
      return {
        type: 'complete',
        message: 'Name filled.',
        checks: [
          { type: 'text', description: 'Expected result is visible', text: 'Name', fresh: false },
        ],
      };
    },
    [
      {
        type: 'value',
        description: 'Expected field value',
        control: { id: null, role: 'textbox', label: 'Name', context: null, group: null },
        equals: 'Ada',
      },
    ],
  );
  const result = await createRuntime({ document, transport: provider }).request(
    'Fill Name with Ada',
  );
  expect(result.status).toBe('triggered');
  expect(document.querySelector('input')!.value).toBe('Ada');
  expect(provider.dom).toHaveBeenCalledTimes(3);
});
it('passes accessible descriptions and placeholder hints through live DOM validation', async () => {
  document.body.innerHTML = `<input placeholder="Search invoices"
    aria-description="Search by invoice number">`;
  const provider = transport(
    (request) => {
      const control = request.snapshot.controls[0]!;
      expect(control).toMatchObject({
        label: '',
        description: 'Search by invoice number',
        placeholder: 'Search invoices',
      });
      if (!request.history.length) {
        return {
          type: 'act',
          message: 'Search for invoice 100',
          step: { type: 'fill', target: control.target, value: 'INV-100' },
        };
      }
      return {
        type: 'complete',
        message: 'Search entered.',
        checks: [
          {
            type: 'text',
            description: 'Expected result is visible',
            text: 'INV-100',
            fresh: false,
          },
        ],
      };
    },
    [
      {
        type: 'value',
        description: 'Expected field value',
        control: { id: null, role: 'textbox', label: '', context: null, group: null },
        equals: 'INV-100',
      },
    ],
  );
  const result = await createRuntime({ document, transport: provider }).request(
    'Search for invoice INV-100',
  );
  expect(result.goalCompleted).toBe(true);
  expect(document.querySelector('input')!.value).toBe('INV-100');
});
it('rejects stale targets if the page changes while the planner is deciding', async () => {
  document.body.innerHTML = '<button>Save</button>';
  const click = vi.fn();
  document.querySelector('button')!.addEventListener('click', click);
  const provider = transport((request) => {
    document.querySelector('button')!.textContent = 'Delete';
    return {
      type: 'act',
      message: 'Click Save',
      step: { type: 'click', target: request.snapshot.controls[0]!.target },
    };
  });
  await expect(
    createRuntime({ document, transport: provider }).request('Click Save'),
  ).rejects.toMatchObject({ code: 'STALE_TARGET' });
  expect(click).not.toHaveBeenCalled();
});
it('uses HTTP planning with the configured planner URL', async () => {
  document.head.innerHTML = '<meta name="ruakit-config">';
  document.querySelector('meta')!.content = JSON.stringify({
    serverUrl: 'http://localhost:4320',
  });
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValue(new Response(JSON.stringify({ type: 'clarify', message: 'Which item?' })));
  await expect(
    createRuntime({ document, fetch: fetcher }).request('Click item'),
  ).rejects.toBeInstanceOf(ClarificationNeededError);
  expect(fetcher.mock.calls[0]![0]).toBe('http://localhost:4320/v1/plan');
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it('honors cancellation before a planner action can execute', async () => {
  document.body.innerHTML = '<button>Save</button>';
  const click = vi.fn();
  document.querySelector('button')!.addEventListener('click', click);
  const controller = new AbortController();
  const provider = transport((request) => {
    controller.abort();
    return {
      type: 'act',
      message: 'Click',
      step: { type: 'click', target: request.snapshot.controls[0]!.target },
    };
  });
  await expect(
    createRuntime({ document, transport: provider }).request('Click Save', {
      signal: controller.signal,
    }),
  ).rejects.toBeDefined();
  expect(click).not.toHaveBeenCalled();
});

it('lets reasoning generate SQL and insert it into a live contenteditable editor', async () => {
  document.body.innerHTML = '<div contenteditable="true" role="textbox" aria-label="SQL"></div>';
  const sql = 'SELECT 1 AS test_value;';
  Object.defineProperty(document, 'execCommand', {
    configurable: true,
    value: vi.fn((_command, _ui, text: string) => {
      document.querySelector('[contenteditable]')!.textContent = text;
      return true;
    }),
  });
  const provider = transport(
    (request) => {
      const editor = request.snapshot.controls[0]!;
      if (!request.history.length) {
        return {
          type: 'act',
          message: 'Write a test query',
          step: { type: 'insertText', target: editor.target, text: sql },
        };
      }
      expect(editor.value).toBe(sql);
      return {
        type: 'complete',
        message: 'Test query written.',
        checks: [
          { type: 'text', description: 'Expected result is visible', text: sql, fresh: false },
        ],
      };
    },
    [
      {
        type: 'value',
        description: 'Expected field value',
        control: { id: null, role: 'textbox', label: 'SQL', context: null, group: null },
        equals: sql,
      },
    ],
  );
  try {
    const result = await createRuntime({
      document,
      transport: provider,
    }).request('Write me a DataFusion query to test my database');
    expect(result.goalCompleted).toBe(true);
    expect(document.querySelector('[contenteditable]')!.textContent).toBe(sql);
  } finally {
    Reflect.deleteProperty(document, 'execCommand');
  }
});
