## The Agent Tool Contract

The product is used by people through the page, and by agents through **tools**.
A tool is a named capability with a description and a schema, registered with the
browser so an agent can invoke it directly instead of guessing at the UI.

This is the second half of the same bargain as the self-check contract: one file
and one exported name are fixed, and **what the tools are is entirely the
product's business.**

### One entry point: `docs/agenttools.js`

```js
/**
 * The product's capabilities, as tools an agent can invoke.
 *
 * Returns an array of tool descriptors. Handlers are plain functions and must
 * not assume the WebMCP API exists — registration is somebody else's job, and
 * the build calls these directly.
 */
export function tools() {
  return [
    {
      name: "get-garden-state",
      description: "Returns the garden's current season, time of day, weather, "
        + "what is growing, and the state of the plot.",
      inputSchema: { type: "object", properties: {} },
      annotations: { readOnlyHint: true },
      example: {},
      async execute(input) {
        return { season: "Spring", timeOfDay: "Morning" /* ... */ };
      },
    },
  ];
}
```

**The descriptor fields are the browser's, not ours** — `name`, `title`,
`description`, `inputSchema`, `execute` and `annotations` are fixed by the
WebMCP specification and cannot be renamed. `execute` is called as
`execute(inputObject, { signal })` and may return anything JSON-serializable;
there is no wrapper envelope.

`example` is the one field we add. It is an input object that is valid for the
tool's own schema, and it exists so the build can actually **call** every tool
rather than only inspect it. A tool nobody has ever invoked is a claim, not a
capability.

### You do not write the registration

`docs/webmcp.js` registers everything `tools()` returns, and it is harness code:
do not create it, edit it, or import the WebMCP API yourself. The specification
is young and has already moved — the method was renamed and moved between
interfaces once — and the whole reason registration lives in one harness file is
so that a revision costs one commit instead of being relearned by every future
product.

The product's only obligation is that `index.html` carries `import "./webmcp.js";`.

### Deriving the tools

The product already maintains a real DOM state layer, because a canvas is opaque
to a screen reader and to the build's own app review alike. That layer is the
answer to "what does this product expose, in words" — and an agent is simply its
third consumer.

So the derivation is mechanical, and deliberately leaves nothing to taste:

- **Every field in the state layer is a read tool.** If the page tells a visitor
  something, an agent can ask for it.
- **Every action a visitor can take is a write tool.** If a person can do it, an
  agent can do it.
- **Nothing else.** A tool that exposes an internal the UI does not is a second
  interface to maintain, and it will drift from the first one.

Two consequences worth stating, because both have been got wrong in other
systems:

- **Do not register a tool whose effect the caller cannot observe.** Orbiting a
  camera changes nothing an agent can read back, so the tool is unfalsifiable
  and its result is a guess. If an action matters, it must also be *visible* in
  something a read tool returns.
- **Group by what a caller wants, not by what the code stores.** One
  `get-garden-state` returning six fields beats six single-field tools: an agent
  asking "what is going on" wants all of it, and six round trips to find out is
  a worse interface than one.

### What the build enforces

Mechanically, with no model involved, so it costs nothing and cannot be argued
with:

- **`tools()` is exported and returns a non-empty array.** A product with no
  tools is a product no agent can use.
- **Names are unique** and lowercase kebab-case.
- **Every tool carries a description.** This is the whole interface: the caller
  cannot see the screen, and it chooses the tool from these words alone. "Gets
  state" does not say which state, of what, or when it is worth asking.
- **`inputSchema` is a JSON Schema object**, and `example` validates against it.
- **Every handler runs.** The build calls each `execute` with its `example` and
  fails the build if it throws, hangs, or returns something unserializable.
- **Mutating tools are annotated.** A tool that changes anything sets
  `readOnlyHint: false`; one that is destructive or hard to undo sets
  `consequentialHint: true`. The annotation is what lets a caller decide whether
  to ask a human first, so an unannotated destructive tool is a defect.

### Cover what you just built

A feature shipped without a tool is invisible to every agent that visits, the
same way a feature shipped without a check is untested. When a change adds
something a visitor can see or do, extend `tools()` in the same change — and add
a check in `docs/selftest.js` that calls the new tool and asserts what it
returns, because the tool layer is product code and gets no special exemption
from the product's own checks.
