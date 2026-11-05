// Copyright 2026 RuaKit contributors. SPDX-License-Identifier: MIT
import { createSession, RuaKitError } from "@ruakit/agent";
import type { RuaSession } from "@ruakit/agent";

export interface RuaSessionOptions {
  document?: Document;
  /** Optional explicit session for framework-neutral integrations. Hooks otherwise share one per document. */
  session?: RuaSession;
}

const sessions = new WeakMap<Document, RuaSession>();

/** Accessed only by imperative methods, never during React rendering. */
export function getSession(options: RuaSessionOptions): RuaSession {
  const document =
    options.document ?? options.session?.document ?? globalThis.document;

  if (!document?.defaultView) {
    throw new RuaKitError("UNAVAILABLE", "RuaKit requires a browser document.");
  }

  if (options.session) {
    if (options.session.document !== document) {
      throw new RuaKitError(
        "INVALID_REQUEST",
        "The Rua session belongs to a different document.",
      );
    }

    return options.session;
  }

  let session = sessions.get(document);
  if (!session) {
    session = createSession({ document });
    sessions.set(document, session);
  }

  return session;
}
