## How this project ships
This is a **static site served by GitHub Pages from `docs/`** — it runs entirely in the browser with **no build step**. You may use any library you can load directly in the browser via ESM / CDN imports (e.g. `import { x } from "https://esm.sh/some-lib"`). Create and name files however you like under `docs/`.

On a brand-new project `docs/` may be empty — that's expected; the first work is then to create the initial files (an `index.html` entry point, plus whatever the change needs).

What the project **is** — its purpose, character, and direction — is defined entirely by the Vision. Follow it; beyond the rendering rules below, nothing about style or stack is dictated.

## Rendering
The garden is rendered in 3D with **Three.js**, loaded straight from a CDN as ESM — no build step, so no bundler and no tree-shaking:

```js
import * as THREE from "https://esm.sh/three";
```

Pin a version once one is working, so a CDN moving on cannot quietly break the garden. Import only what a scene needs and keep it lean: "Effortless" is a Vision principle, and a garden you can feel the code working in has already lost the illusion.

**A WebGL canvas is not the whole app.** Alongside the scene, maintain a real DOM layer describing the garden's current state — what is growing, the weather, the season, what is happening right now — kept accurate as the scene changes and reachable from the keyboard. This is not decoration, and it is not optional:

- A canvas is opaque to screen readers, and the Vision makes them first-class: *"the calm should reach someone who never sees the animation at all."*
- The build's own app review measures the **DOM** — contrast, layout, overflow, interactive elements. It cannot see into a canvas. A page that is one bare `<canvas>` is a page it can report nothing about, so real defects would ship unnoticed and nothing downstream would ever catch them.
