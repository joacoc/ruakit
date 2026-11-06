<p align="center">
  <picture>
    <source
      media="(prefers-color-scheme: light)"
      srcset="https://github.com/user-attachments/assets/346281fc-bcdb-4fb0-98e4-16a52189dc23"
    />
    <source
      media="(prefers-color-scheme: dark)"
      srcset="https://github.com/user-attachments/assets/0f624064-5c66-44b5-bbc9-20d92f356946"
    />
    <img
      width="512"
      alt="Wordmark"
      src="https://github.com/user-attachments/assets/346281fc-bcdb-4fb0-98e4-16a52189dc23"
    />
  </picture>
</p>


**Runtime for React Use Agents (RUA)**

RuaKit lets agents understand your UI state, click buttons, complete forms, and trigger actions on behalf of users.
You can integrate it into chats, toolbars, inline interfaces, or wherever you need it.

**Why RuaKit?**

Chats are limited to Q&A or guidance and lack access to your UI. RuaKit brings agents right into your app runtime so they can actually see what's happening inside your application and carry out the tasks your users request.

## Getting started

**Prerequisites**

Install the required packages:

```bash
npm install @ruakit/react @ruakit/schema @ruakit/agent
```

#### 1. Set up an endpoint

We strongly recommend using a frontier model, such as `gpt-6.1-terra`.

```ts
// In Next.js: app/v1/plan/route.ts
import { generateObject } from "ai";
import { systemPrompt } from "@ruakit/agent";
import { planRequestSchema, planDraftResponseSchema, planResponseSchema } from "@ruakit/schema";

export async function POST(req: Request) {
  const input = planRequestSchema.parse(await req.json());

  const { object } = await generateObject({
    model: "openai/gpt-6.1-terra",
    schema: planDraftResponseSchema,
    system: systemPrompt,
    prompt: JSON.stringify(input),
  });

  return Response.json(planResponseSchema.parse(object));
}
```

The example uses the `ai` library, but you can use any provider or SDK you already have, as long as your endpoint returns JSON that matches `planResponseSchema`.

#### 2. Add the toolbar

Add it to your root layout (you can remove it later on):

```tsx
// app/layout.tsx
import { Rua } from "@ruakit/react";

export default function Layout({ children }) {
  return (
    <html lang="en">
      <body>
        {children}
        <Rua />
      </body>
    </html>
  );
}
```

#### 3. Integrate

Use `useRua` for more custom experiences.

```tsx
import { useRua } from "@ruakit/react";

function AgentHelp() {
  const { submit, loading } = useRua();

  return (
    <button disabled={loading} onClick={() => submit("Help me fill out this form")}>
      Help me fill out this form
    </button>
  );
}
```

See the [schema reference](https://github.com/joacoc/ruakit/blob/main/docs/schema.md) for every step type.

## Documentation

- [How RuaKit works](docs/how-it-works.md)
- [Hooks](docs/hooks.md)
- [Plans](docs/plans.md)

## Package reference

| Package                              | Documentation                                     |
| ------------------------------------ | ------------------------------------------------- |
| [`@ruakit/react`](docs/react.md)     | Hooks, toolbar, and visual cursor                 |
| [`@ruakit/agent`](docs/agent.md)     | Sessions, planning, and request lifecycle         |
| [`@ruakit/runtime`](docs/runtime.md) | DOM observation and browser actions               |
| [`@ruakit/schema`](docs/schema.md)   | Plans, requests, decisions, and completion checks |
| [`@ruakit/nextjs`](docs/nextjs.md)   | Server route, authentication, and configuration   |

See the [full documentation index](docs/README.md) for all topics.
