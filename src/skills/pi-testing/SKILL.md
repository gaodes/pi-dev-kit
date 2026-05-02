---
name: pi-testing
description: Test Pi extensions and packages. Use when writing tests for a Pi extension, setting up test fixtures, mocking tools and UI, or verifying package installs. Documents the @gaodes/pi-test-harness framework.
---

# Pi Testing

Test Pi extensions using `@gaodes/pi-test-harness` — in-process testing with real Pi runtime, no LLM calls required.

## Philosophy

> **Let Pi be Pi.** Only the LLM boundary is replaced. Everything else — extension loading, tool registration, hooks, event lifecycle, session state — runs through Pi's real code.

Install: `npm install --save-dev @gaodes/pi-test-harness`

Peer dependencies: `@mariozechner/pi-coding-agent` >= 0.50.0, `@mariozechner/pi-ai`, `@mariozechner/pi-agent-core`.

## Quick Start

```typescript
import { describe, it, expect, afterEach } from "vitest";
import {
  createTestSession,
  when,
  calls,
  says,
  type TestSession,
} from "@gaodes/pi-test-harness";

describe("my extension", () => {
  let t: TestSession;
  afterEach(() => t?.dispose());

  it("calls a tool and responds", async () => {
    t = await createTestSession({
      extensions: ["./src/index.ts"],
      mockTools: {
        bash: (params) => `$ ${params.command}\nfile1.txt`,
        read: "file contents",
      },
    });

    await t.run(
      when("List files", [
        calls("bash", { command: "ls" }),
        says("Found file1.txt"),
      ])
    );

    expect(t.events.toolResultsFor("bash")).toHaveLength(1);
  });
});
```

## Playbook DSL

The playbook replaces the LLM. Scripts what the "model" does:

- `when(prompt, actions)` — defines a turn
- `calls(tool, params)` — the model calls a tool
- `says(text)` — the model emits text, turn ends

Multi-turn:

```typescript
await t.run(
  when("First prompt", [calls("bash", { command: "ls" }), says("Done.")]),
  when("Second prompt", [
    calls("read", { path: "file.txt" }),
    says("Contents..."),
  ])
);
```

### Late-bound Params

When one tool produces a value needed by the next:

```typescript
let id = "";
await t.run(
  when("Create and use", [
    calls("create_item", { name: "test" }).then((result) => {
      id = result.text.match(/ID-(\w+)/)![0];
    }),
    calls("use_item", () => ({ id })), // resolved at call time
    says("Done."),
  ])
);
```

## Mock Tools

Intercept `tool.execute()` for specific tools. Hooks still fire.

```typescript
mockTools: {
  bash: "static output",                              // static string
  read: (params) => `contents of ${params.path}`,    // dynamic function
  write: { content: [{ type: "text", text: "ok" }], details: {} },  // full result
}
```

Extension-registered tools execute for real unless in `mockTools`.

## Mock UI

Control what the user "answers":

```typescript
mockUI: {
  confirm: false,                                    // deny all
  select: 0,                                         // first item
  input: "user text",                                // fixed string
  editor: "edited content",                          // fixed string
}
```

Dynamic:

```typescript
mockUI: {
  confirm: (title, msg) => title.includes("Delete") ? false : true,
  select: (title, items) => items.find(i => i.includes("staging")),
}
```

## Event Assertions

```typescript
t.events.toolCallsFor("bash"); // all calls to bash
t.events.toolResultsFor("bash"); // all results from bash
t.events.blockedCalls(); // calls blocked by hooks
t.events.uiCallsFor("confirm"); // all confirm() calls
t.events.uiCallsFor("notify"); // all notify() calls
t.events.messages; // all agent messages
t.events.all; // raw event stream
```

## Error Propagation

Default (`propagateErrors: true`): real tool errors abort the test with a diagnostic pointing to the exact playbook step.

Set `propagateErrors: false` to capture errors as `isError: true` results.

## Package Install Verification

```typescript
import { verifySandboxInstall } from "@gaodes/pi-test-harness";

const result = await verifySandboxInstall({
  packageDir: "./packages/my-extension",
  expect: {
    extensions: 1,
    tools: ["my_tool", "my_other_tool"],
    skills: 0,
  },
});
expect(result.loaded.extensionErrors).toEqual([]);
```

With smoke test:

```typescript
smoke: {
  mockTools: { bash: "ok", read: "contents" },
  script: [when("Test", [calls("my_tool", { value: "x" }), says("Works.")])],
}
```

## Mock Pi CLI

For extensions that spawn `pi --mode json -p`:

```typescript
import { createMockPi } from "@gaodes/pi-test-harness";

const mockPi = createMockPi();
mockPi.install(); // prepends fake pi to PATH
mockPi.onCall({ output: "Hello", exitCode: 0 });
// ... run test ...
mockPi.uninstall(); // cleanup
```

## Checklist

- [ ] Extension loads without errors in test session
- [ ] Playbook covers main tool workflows
- [ ] Mock tools used for external dependencies
- [ ] Mock UI configured for dialog interactions
- [ ] Event assertions verify tool calls and results
- [ ] `t.dispose()` in `afterEach`
- [ ] Error propagation set appropriately
- [ ] `verifySandboxInstall` used before publishing
