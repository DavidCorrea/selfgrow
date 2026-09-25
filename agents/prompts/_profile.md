## How this project ships
This is a **static site served by GitHub Pages from `docs/`** — it runs entirely in the browser with **no build step**. You may use any library you can load directly in the browser via ESM / CDN imports (e.g. `import { x } from "https://esm.sh/some-lib"`). Create and name files however you like under `docs/`.

On a brand-new project `docs/` may be empty — that's expected; the first work is then to create the initial files (an `index.html` entry point, plus whatever the change needs).

What the project **is** — its purpose, character, and direction — is defined entirely by the Vision. Follow it; beyond the rendering rules below, nothing about style or stack is dictated.

## Rendering
**How the product looks is the Vision's call**, not this page's. Use whatever the Vision asks for and the browser can do without a build step — styled HTML and CSS, SVG, images, or a `<canvas>` / WebGL library loaded from a CDN as ESM. Pin a library's version once one is working, so a CDN moving on cannot quietly break the product. Import only what the page needs and keep it lean: a page you can feel the code working in has already lost the illusion.

**The DOM is the product, whatever draws the pixels.** The product's state — what is on screen, what it means, what is happening right now — lives in real, keyboard-reachable page elements, kept accurate as it changes. If any part is drawn into a canvas, that canvas sits beside this layer; it never replaces it. This is not decoration, and it is not optional:

- A canvas is opaque to screen readers, and the product has to reach someone who never sees the animation at all.
- The build's own app review measures the **DOM** — contrast, layout, overflow, interactive elements. It cannot see into a canvas. A page that is one bare `<canvas>` is a page it can report nothing about, so real defects would ship unnoticed and nothing downstream would ever catch them.
