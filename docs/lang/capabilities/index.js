/**
 * Barrel file — dynamically imports all capability modules in this directory.
 * Exports a promise that resolves to an array of capabilities, each with:
 *   { meta, register, checkProperties }
 */
async function loadCapabilities() {
  const baseUrl = new URL('./', import.meta.url);
  let response;
  try {
    response = await fetch(baseUrl);
  } catch (err) {
    console.error('Failed to fetch capability directory:', err);
    // Fallback: try to import known modules statically (for environments without directory listing)
    return loadFallback();
  }
  if (!response.ok) {
    console.error(`Failed to fetch directory: ${response.status} ${response.statusText}`);
    return loadFallback();
  }
  const text = await response.text();
  const parser = new DOMParser();
  const doc = parser.parseFromString(text, 'text/html');
  const links = Array.from(doc.querySelectorAll('a'))
    .map(a => a.href)
    .filter(href => {
      try {
        const url = new URL(href);
        // Same origin and same directory
        return url.origin === location.origin && url.pathname.startsWith(baseUrl.pathname) && url.pathname.endsWith('.js');
      } catch (_) {
        return false;
      }
    })
    // Remove duplicates and exclude this barrel file
    .filter((href, index, self) => {
      const url = new URL(href);
      return self.indexOf(href) === index && url.pathname !== `${baseUrl.pathname}index.js`;
    });

  const capabilities = [];
  for (const href of links) {
    try {
      const module = await import(href);
      // Expect the module to export meta, register, checkProperties
      if (!module.meta || typeof module.register !== 'function' || typeof module.checkProperties !== 'function') {
        console.warn(`Module ${href} does not export required meta/register/checkProperties`);
        continue;
      }
      capabilities.push({
        meta: module.meta,
        register: module.register,
        checkProperties: module.checkProperties,
      });
    } catch (err) {
      console.error(`Failed to import module ${href}:`, err);
    }
  }

  // If we found no modules, fall back to static import to avoid breaking
  if (capabilities.length === 0) {
    console.warn('No capability modules found via dynamic import; falling back to static import.');
    return loadFallback();
  }

  return capabilities;
}

async function loadFallback() {
  // Import known modules statically (update this list when adding new capabilities)
  // This is a fallback for environments where directory listing is not available.
  // We will still need to update this list when adding a new capability, but we hope
  // that the dynamic import works in the deployed environment.
  try {
    const arithmetic = await import('./arithmetic.js');
    return [{
      meta: arithmetic.meta,
      register: arithmetic.register,
      checkProperties: arithmetic.checkProperties,
    }];
  } catch (err) {
    console.error('Failed to load fallback capabilities:', err);
    return [];
  }
}

// Export a promise that resolves to the capabilities array
export const capabilitiesPromise = loadCapabilities();

// For backward compatibility, also export a placeholder (unused by the updated registry)
export const capabilities = [];

export default capabilitiesPromise;
