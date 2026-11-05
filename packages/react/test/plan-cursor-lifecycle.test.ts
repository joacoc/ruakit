// Copyright 2026 RuaKit contributors. SPDX-License-Identifier: Apache-2.0
// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { RuaCursor, useRua } from '../dist/index.js';
import type { CursorVisibility, RequestPlan, RuaAgent } from '../dist/index.js';

let root: Root | undefined;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(
    () => [new DOMRect(100, 100, 100, 30)] as unknown as DOMRectList,
  );
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
    () => new DOMRect(100, 100, 100, 30),
  );
});
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it.each<CursorVisibility>(['plan', 'session'])(
  'retains one operation and a visible cursor through a slow plan using %s visibility',
  async (visibility) => {
    document.body.innerHTML =
      '<label>First name<input></label><label>Last name<input></label>';
    let release!: () => void;
    let reachedPause!: () => void;
    const pause = new Promise<void>((resolve) => {
      release = resolve;
    });
    const waiting = new Promise<void>((resolve) => {
      reachedPause = resolve;
    });
    const identities: string[] = [];
    const request: RequestPlan = async (input, _context, _signal, identity) => {
      identities.push(identity.operationId);
      const target = (label: string) => ({ id: null, role: 'textbox', label, context: null, group: null });
      const checks = ['First name', 'Last name'].map((label, index) => ({
        type: 'value' as const, description: label, control: target(label), equals: index === 0 ? 'Alex' : 'Morgan',
      }));
      if (input.replan) {
        reachedPause();
        await pause;
        return {
          id: 'last-name', replacesPlanId: input.replan.planId, message: 'Done', checks,
          steps: [{ id: 'last', type: 'fill', message: 'Fill last name', target: target('Last name'), value: 'Morgan' }],
        };
      }
      return {
        id: 'first-name', message: 'Complete the name', checks,
        steps: [{ id: 'first', type: 'fill', message: 'Fill first name', target: target('First name'), value: 'Alex' }],
      };
    };
    let plan!: RuaAgent;
    function Harness() {
      plan = useRua({ request });
      return createElement(RuaCursor, {
        action: plan.action,
        active: plan.loading,
        visibility,
      });
    }
    root = createRoot(document.body.appendChild(document.createElement('div')));
    await act(async () => root!.render(createElement(Harness)));
    let pending!: ReturnType<RuaAgent['execute']>;
    await act(async () => {
      pending = plan.execute({ prompt: 'Complete the name' });
      await waiting;
    });
    const pointer = document.querySelector('.ruakit-cursor-pointer');
    expect(pointer).not.toBeNull();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 800));
    });
    expect(plan.loading).toBe(true);
    expect(plan.action?.phase).toBe('after');
    expect(
      document.querySelector<HTMLElement>('[data-ruakit-cursor]')?.style
        .opacity,
    ).toBe('1');
    expect(document.querySelector('.ruakit-cursor-pointer')).toBe(pointer);
    await act(async () => {
      release();
      await pending;
    });
    expect(await pending).toMatchObject({ status: 'completed' });
    expect(new Set(identities).size).toBe(1);
    expect(identities).toHaveLength(2);
    expect(plan.loading).toBe(false);
    expect(plan.action).toBeNull();
    if (visibility === 'session') {
      expect(document.querySelector('.ruakit-cursor-pointer')).toBe(pointer);
      expect(document.querySelector('.ruakit-cursor-highlight')).toBeNull();
      await act(async () => {
        await plan.execute({ prompt: 'Complete the name again' });
      });
      expect(plan.action).toBeNull();
      expect(document.querySelector('.ruakit-cursor-pointer')).toBe(pointer);
      expect(identities.at(-1)).not.toBe(identities[0]);
    } else {
      expect(document.querySelector('[data-ruakit-cursor]')).toBeNull();
    }
  },
);
