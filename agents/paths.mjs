// Where the harness lives on disk.

import { dirname, join } from "path";
import { fileURLToPath } from "url";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

export const agentsDir = dirname(fileURLToPath(import.meta.url));
export const repoRoot = join(agentsDir, "..");
export const promptsDir = join(agentsDir, "prompts");
