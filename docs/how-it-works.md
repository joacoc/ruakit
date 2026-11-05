# How RuaKit works

[Documentation index](README.md) - [RuaKit](../README.md)

An agent needs to know what’s happening in your app before it can do anything useful. RuaKit gives it that context, then runs a simple loop until the job is done:

<p align="center">
  <img width="500" alt="Flow" src="https://github.com/user-attachments/assets/3a56a5c1-887f-4a89-8692-314efe23817b" />
</p>

1. Read state: RuaKit reads the page through the DOM (visible text, labels, buttons, form fields) and can take a screenshot when the model needs visual context.
2. Plan next step: The model uses the page and the user’s request to decide what to do next, like opening a menu, filling a field, or saving.
3. Execute: RuaKit confirms the target is still on the page, then clicks, selects, or fills.
4. Evaluate: RuaKit checks that the expected results are on the page. If they are, the run ends. If a step failed or results are missing, it loops back to step 1 with the current page and completed steps. You can add your own checks for outcomes the UI can’t confirm.

The `useRua` hook runs this whole loop for you, including requests and replanning. For more control, use `usePlan(plan)` to execute a plan you already have, or combine `useSnapshot` and `useRun` to handle each decision yourself.
