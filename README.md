<p align="center">
  <img width="500" alt="RuaKit" src="https://github.com/user-attachments/assets/6072a775-92de-4841-9a53-f061f7f71c50" />
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
npm install @ruakit/react @ruakit/schema
```

#### 1. Set up an endpoint

A planner endpoint (`/v1/plan`) receives the user's `prompt` and a `snapshot` of the page and returns a valid [plan](https://github.com/joacoc/ruakit/blob/main/docs/schema.md#a-complete-plan). The plan is defined by a [Zod](https://zod.dev) schema, so passing the schema to your model guarantees a valid response. We strongly recommend reading [`How RuaKit works`](https://github.com/joacoc/ruakit/blob/main/docs/how-it-works.md) to understand the runtime and planner behaviour.

```ts
// In Next.js: app/v1/plan/route.ts
import { generateObject } from "ai";
import { planRequestSchema, planSchema } from "@ruakit/schema";

export async function POST(req: Request) {
  const input = planRequestSchema.parse(await req.json());

  const { object } = await generateObject({
    model: "your-model",
    schema: planSchema,
    system: `
      Build UI plans using supported actions and observed controls.
      Proceed with simple actions without extra confirmation.
      Clarify missing details. Request approval for consequential actions and protect credentials.
      Define checks for every outcome. Preserve them and never repeat completed actions when replanning.
    `,
    prompt: JSON.stringify(input),
  });

  return Response.json(object);
}
```

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
