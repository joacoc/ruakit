// Copyright 2026 RuaKit contributors. SPDX-License-Identifier: MIT
import { z } from 'zod';

/** Host-observed link activation; it does not establish destination loading. */
export const linkNavigationSchema = z.strictObject({
  url: z.url({ protocol: /^https?$/ }).max(4000),
  target: z.literal('_blank'),
});
