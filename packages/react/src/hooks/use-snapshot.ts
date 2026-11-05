// Copyright 2026 RuaKit contributors. SPDX-License-Identifier: MIT
import { useCallback, useEffect, useRef } from "react";
import { RuaKitError } from "@ruakit/agent";
import type { PageState } from "@ruakit/agent";
import { getSession } from "../lib/session.js";
import type { RuaSessionOptions } from "../lib/session.js";

/** Return an imperative snapshot reader; construction and observation wait until it is called. */
export function useSnapshot(options: RuaSessionOptions = {}): () => PageState {
  const committedOptions = useRef(options);
  const mounted = useRef(false);

  useEffect(() => {
    committedOptions.current = options;
  }, [options]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  return useCallback(() => {
    if (!mounted.current) {
      throw new RuaKitError(
        "UNAVAILABLE",
        "Take a Rua snapshot after the component has mounted.",
      );
    }

    return getSession(committedOptions.current).snapshot();
  }, []);
}
