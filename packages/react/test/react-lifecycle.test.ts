// Copyright 2026 RuaKit contributors. SPDX-License-Identifier: Apache-2.0
// @vitest-environment jsdom
import { act, createElement, StrictMode, useEffect } from "react";
import type { ReactElement } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExecutionResult } from "@ruakit/schema";
import type * as Agent from "@ruakit/agent";
import { Rua, useRua } from "../dist/index.js";
import { createRuntime } from "@ruakit/agent";
import type { RuaKitRuntime, PlanRuntimeOptions } from "@ruakit/agent";
import type { PlanTransport } from "@ruakit/agent";

vi.mock("@ruakit/agent", async (importOriginal) => ({
  ...(await importOriginal<typeof Agent>()),
  createRuntime: vi.fn(),
}));

type HookOptions = NonNullable<Parameters<typeof useRua>[0]>;
type RequestController = ReturnType<typeof useRua>;

const roots = new Set<Root>();
const success: ExecutionResult = {
  planId: "lifecycle-plan",
  status: "triggered",
  events: ["Action triggered"],
};

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
});

afterEach(async () => {
  await act(async () => {
    for (const root of roots) {
      root.unmount();
    }
    roots.clear();
  });
  document.body.replaceChildren();
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});

function deferredResult() {
  let resolve!: (result: ExecutionResult) => void;
  let reject!: (error: Error) => void;
  const pending = new Promise<ExecutionResult>((accept, refuse) => {
    resolve = accept;
    reject = refuse;
  });
  return { pending, resolve, reject };
}

function mockRequest() {
  const deferred = deferredResult();
  // Deliberately settle independently of abort to exercise stale adapter callbacks.
  const request = vi.fn<RuaKitRuntime["request"]>(() => deferred.pending);
  vi.mocked(createRuntime).mockReturnValue({ request });
  return { ...deferred, request };
}

function mountRoot(): Root {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.add(root);
  return root;
}

async function mountHook(
  options: HookOptions = { serverUrl: "/planner" },
  strict = false,
) {
  let controller: RequestController | undefined;
  function Harness(props: HookOptions): ReactElement {
    controller = useRua(props);
    return createElement("span", { role: "status" }, controller.state.message);
  }
  const root = mountRoot();
  async function render(nextOptions: HookOptions): Promise<void> {
    await act(async () => {
      const harness = createElement(Harness, nextOptions);
      root.render(strict ? createElement(StrictMode, null, harness) : harness);
    });
  }
  await render(options);
  return {
    root,
    render,
    current(): RequestController {
      if (!controller) {
        throw new Error("Request hook has not rendered.");
      }
      return controller;
    },
  };
}

function latestPlanRuntimeOptions(): PlanRuntimeOptions {
  const options = vi.mocked(createRuntime).mock.calls.at(-1)?.[0];
  if (!options) {
    throw new Error("No runtime was constructed.");
  }
  return options;
}

function query<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Missing toolbar element: ${selector}`);
  }
  return element;
}

async function mountToolbar(): Promise<void> {
  const root = mountRoot();
  await act(async () =>
    root.render(createElement(Rua, { serverUrl: "/planner" })),
  );
  await act(async () =>
    query<HTMLButtonElement>('[aria-label="Open Rua"]').click(),
  );
}

function requestBox(): HTMLTextAreaElement {
  return query('[aria-label="Rua request"]');
}

async function type(prompt: string): Promise<void> {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    "value",
  )?.set;
  if (!setter) {
    throw new Error("Missing textarea value setter.");
  }
  await act(async () => {
    setter.call(requestBox(), prompt);
    requestBox().dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function enter(options: KeyboardEventInit = {}): Promise<void> {
  await act(async () => {
    requestBox().dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
        ...options,
      }),
    );
  });
}

describe("React request ownership", () => {
  it("reports an action receipt without claiming goal completion", async () => {
    const test = mockRequest();
    const hook = await mountHook();
    let pending!: ReturnType<RequestController["execute"]>;
    await act(async () => {
      pending = hook.current().execute({ prompt: "Open billing" });
    });
    await act(async () => test.resolve(success));
    expect(await pending).toMatchObject({
      status: "triggered",
      result: success,
    });
    expect((await pending).status).not.toBe("completed");
  });

  it("starts only one request when submissions happen before React renders again", async () => {
    const test = mockRequest();
    const hook = await mountHook();
    expect(hook.current().loading).toBe(false);
    let first: Promise<ExecutionResult | undefined> | undefined;
    let duplicate: Promise<ExecutionResult | undefined> | undefined;
    await act(async () => {
      first = hook.current().submit("Open billing");
      duplicate = hook.current().submit("Download invoice");
    });
    expect(await duplicate).toBeUndefined();
    expect(createRuntime).toHaveBeenCalledTimes(1);
    expect(test.request).toHaveBeenCalledTimes(1);
    expect(hook.current().loading).toBe(true);
    await act(async () => test.resolve(success));
    expect(await first).toBe(success);
    expect(hook.current().state.status).toBe("triggered");
    expect(hook.current().loading).toBe(false);
  });

  it("holds cancellation until settlement and ignores late progress or success", async () => {
    const test = mockRequest();
    const hook = await mountHook();
    let pending: Promise<ExecutionResult | undefined> | undefined;
    await act(async () => {
      pending = hook.current().submit("Open billing");
    });
    const callbacks = latestPlanRuntimeOptions();
    await act(async () => {
      callbacks.onPhaseChange?.("planning");
      callbacks.onProgress?.("Choosing an action");
    });
    expect(hook.current().state).toMatchObject({
      phase: "planning",
      message: "Choosing an action",
    });

    await act(async () => hook.current().cancel());
    expect(test.request.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    expect(hook.current().state.status).toBe("cancelling");
    expect(hook.current().loading).toBe(true);
    await act(async () => {
      callbacks.onProgress?.("Late progress");
      callbacks.onPhaseChange?.("executing");
      await hook.current().submit("Another request");
    });
    expect(test.request).toHaveBeenCalledTimes(1);
    expect(hook.current().state).toMatchObject({
      status: "cancelling",
      phase: "planning",
      message: "Cancelling request…",
    });

    await act(async () => test.resolve(success));
    expect(await pending).toBeUndefined();
    expect(hook.current().state.status).toBe("cancelled");
    expect(hook.current().loading).toBe(false);
  });

  it("uses updated options for the next request without changing an active request", async () => {
    const test = mockRequest();
    const hook = await mountHook();
    const fetcher = vi.fn<typeof fetch>();
    const transport: PlanTransport = {
      plan: vi.fn<PlanTransport["dom"]>(),
    };
    const updated: HookOptions = {
      serverUrl: "/updated-planner",
      transport,
      fetch: fetcher,
      requestTimeoutMs: 12000,
    };
    await act(async () => {
      void hook.current().submit("First request");
    });
    await hook.render(updated);
    expect(latestPlanRuntimeOptions().serverUrl).toBe("/planner");
    expect(test.request).toHaveBeenCalledTimes(1);
    await act(async () => test.resolve(success));

    const second = mockRequest();
    await act(async () => {
      void hook.current().submit("Second request");
    });
    expect(latestPlanRuntimeOptions()).toMatchObject(updated);
    expect(latestPlanRuntimeOptions().transport).toBe(transport);
    expect(latestPlanRuntimeOptions().fetch).toBe(fetcher);
    await act(async () => second.resolve(success));
  });

  it("keeps methods stable while retained submissions use the latest committed options", async () => {
    const first = mockRequest();
    const submitEffect = vi.fn();
    let controller: RequestController | undefined;
    function Consumer(options: HookOptions): ReactElement {
      const request = useRua(options);
      controller = request;
      useEffect(() => {
        submitEffect();
      }, [request.submit]);
      return createElement("span", { role: "status" }, request.state.message);
    }
    function current(): RequestController {
      if (!controller) {
        throw new Error("Request consumer has not rendered.");
      }
      return controller;
    }
    const root = mountRoot();
    await act(async () =>
      root.render(createElement(Consumer, { serverUrl: "/initial-planner" })),
    );
    const { submit, cancel } = current();
    await act(async () => {
      void submit("First request");
    });
    await act(async () => {
      latestPlanRuntimeOptions().onPhaseChange?.("planning");
      latestPlanRuntimeOptions().onProgress?.("Choosing a control");
    });
    expect(current().submit).toBe(submit);
    expect(current().cancel).toBe(cancel);
    await act(async () => first.resolve(success));
    expect(current().state.status).toBe("triggered");
    expect(current().submit).toBe(submit);
    expect(current().cancel).toBe(cancel);

    const fetcher = vi.fn<typeof fetch>();
    const updated: HookOptions = {
      serverUrl: "/updated-planner",
      fetch: fetcher,
      requestTimeoutMs: 12000,
    };
    await act(async () => root.render(createElement(Consumer, updated)));
    expect(current().submit).toBe(submit);
    expect(current().cancel).toBe(cancel);
    expect(submitEffect).toHaveBeenCalledTimes(1);

    const second = mockRequest();
    await act(async () => {
      void submit("Second request");
    });
    expect(latestPlanRuntimeOptions()).toMatchObject(updated);
    expect(latestPlanRuntimeOptions().fetch).toBe(fetcher);
    expect(second.request).toHaveBeenCalledWith(
      "Second request",
      expect.any(Object),
    );
    await act(async () => second.resolve(success));
    expect(current().submit).toBe(submit);
    expect(current().cancel).toBe(cancel);
    expect(submitEffect).toHaveBeenCalledTimes(1);
  });

  it("aborts on unmount and isolates late callbacks from a replacement hook", async () => {
    const old = mockRequest();
    const hook = await mountHook();
    let pending: Promise<ExecutionResult | undefined> | undefined;
    await act(async () => {
      pending = hook.current().submit("Old request");
    });
    const callbacks = latestPlanRuntimeOptions();
    const signal = old.request.mock.calls[0]?.[1]?.signal;
    await act(async () => hook.root.unmount());
    roots.delete(hook.root);
    expect(signal?.aborted).toBe(true);

    const replacement = await mountHook();
    await act(async () => {
      callbacks.onProgress?.("Obsolete progress");
      callbacks.onPhaseChange?.("executing");
      old.resolve(success);
    });
    expect(await pending).toBeUndefined();
    expect(replacement.current().state).toMatchObject({
      status: "idle",
      message: "Ready",
    });
    expect(replacement.current().loading).toBe(false);
  });

  it("remains usable after Strict Mode repeats effect setup and cleanup", async () => {
    const test = mockRequest();
    const hook = await mountHook({ serverUrl: "/planner" }, true);
    expect(createRuntime).not.toHaveBeenCalled();
    let pending: Promise<ExecutionResult | undefined> | undefined;
    await act(async () => {
      pending = hook.current().submit("Open billing");
    });
    expect(test.request).toHaveBeenCalledTimes(1);
    expect(test.request.mock.calls[0]?.[1]?.signal?.aborted).toBe(false);
    await act(async () => test.resolve(success));
    expect(await pending).toBe(success);
    expect(hook.current().state.status).toBe("triggered");
  });

  it("isolates replayed Strict Mode requests started by a consumer effect", async () => {
    const first = deferredResult();
    const second = deferredResult();
    const request = vi
      .fn<RuaKitRuntime["request"]>()
      .mockImplementationOnce(() => first.pending)
      .mockImplementationOnce(() => second.pending);
    vi.mocked(createRuntime).mockReturnValue({ request });
    const pending: Promise<ExecutionResult | undefined>[] = [];
    let current: RequestController | undefined;
    function Consumer(): ReactElement {
      const controller = useRua({ serverUrl: "/planner" });
      current = controller;
      useEffect(() => {
        pending.push(controller.submit("Open billing"));
      }, []);
      return createElement(
        "span",
        { role: "status" },
        controller.state.message,
      );
    }
    const root = mountRoot();
    await act(async () => {
      root.render(createElement(StrictMode, null, createElement(Consumer)));
    });
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    expect(request.mock.calls[1]?.[1]?.signal?.aborted).toBe(false);
    expect(current?.state).toMatchObject({ status: "running", requestId: 2 });

    const currentCallbacks = latestPlanRuntimeOptions();
    const obsoleteCallbacks = vi.mocked(createRuntime).mock.calls[0]?.[0];
    await act(async () => {
      currentCallbacks.onPhaseChange?.("planning");
      currentCallbacks.onProgress?.("Planning the current request");
      obsoleteCallbacks?.onPhaseChange?.("executing");
      obsoleteCallbacks?.onProgress?.("Obsolete progress");
    });
    expect(current?.state).toMatchObject({
      status: "running",
      requestId: 2,
      phase: "planning",
      message: "Planning the current request",
    });

    await act(async () => first.resolve(success));
    expect(await pending[0]).toBeUndefined();
    expect(current?.state).toMatchObject({ status: "running", requestId: 2 });
    await act(async () => {
      expect(await current?.submit("Duplicate request")).toBeUndefined();
    });
    expect(request).toHaveBeenCalledTimes(2);

    await act(async () => second.resolve(success));
    expect(await pending[1]).toBe(success);
    expect(current?.state).toMatchObject({ status: "triggered", requestId: 2 });
  });

  it("settles construction errors as failures and accepts the next request", async () => {
    vi.mocked(createRuntime).mockImplementationOnce(() => {
      throw new Error("RuaKit requires a browser document.");
    });
    const hook = await mountHook();
    await act(async () => {
      expect(await hook.current().submit("Open billing")).toBeUndefined();
    });
    expect(hook.current().state).toMatchObject({
      status: "failed",
      message: "RuaKit requires a browser document.",
    });
    expect(hook.current().loading).toBe(false);

    const retry = mockRequest();
    await act(async () => {
      void hook.current().submit("Try again");
    });
    expect(retry.request).toHaveBeenCalledTimes(1);
    await act(async () => retry.resolve(success));
    expect(hook.current().state.status).toBe("triggered");
  });
});

describe("toolbar lifecycle interaction", () => {
  it("preserves the draft when a cancelled adapter returns a late success", async () => {
    const test = mockRequest();
    await mountToolbar();
    await type("Download invoice");
    await enter();
    await act(async () =>
      query<HTMLButtonElement>('[aria-label="Cancel request"]').click(),
    );
    expect(requestBox().readOnly).toBe(true);
    expect(query('[role="status"]').textContent).toBe("Cancelling request…");
    await act(async () => test.resolve(success));
    expect(requestBox().value).toBe("Download invoice");
    expect(requestBox().readOnly).toBe(false);
    expect(query('[role="status"]').textContent).toBe("Request cancelled");
    expect(document.activeElement).toBe(requestBox());
  });

  it("keeps composition and Shift+Enter from submitting and normalizes pasted line breaks", async () => {
    const test = mockRequest();
    await mountToolbar();
    await type("Open\nbilling\r\npage");
    expect(requestBox().value).toBe("Open billing page");
    await enter({ isComposing: true });
    await enter({ shiftKey: true });
    expect(test.request).not.toHaveBeenCalled();
    expect(requestBox().value).toBe("Open billing page");
    await enter();
    expect(test.request).toHaveBeenCalledWith(
      "Open billing page",
      expect.any(Object),
    );
    await act(async () => test.resolve(success));
  });
});

it("keeps the toolbar running when the user interacts with the page", async () => {
  const mocked = mockRequest();
  const hook = await mountHook();
  let pending: Promise<ExecutionResult | undefined> | undefined;
  await act(async () => {
    pending = hook.current().submit("Write a query");
  });
  await act(async () => {
    document.body.click();
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "a", bubbles: true }),
    );
    document.dispatchEvent(new WheelEvent("wheel", { bubbles: true }));
  });
  expect(hook.current().loading).toBe(true);
  expect(hook.current().state.status).toBe("running");
  expect(document.querySelector("[data-interrupted]")).toBeNull();
  await act(async () => {
    mocked.resolve(success);
    await pending;
  });
  expect(hook.current().state.status).toBe("triggered");
});
