// The project board.

import { log, errorData } from "./log.mjs";
import { ghExec } from "./git.mjs";
import { LISTING_LIMIT, rejectTruncated } from "./github.mjs";

// ---------------------------------------------------------------------------
// GitHub Projects (Kanban board) helpers
//
// All board operations are BEST-EFFORT: they log and return false/null on any
// failure and never throw, so the board can never break the build/commit flow.
// Requires `gh` authenticated with a token carrying the `project` scope
// (set GH_TOKEN to a PAT in CI — the default GITHUB_TOKEN can't access Projects).
// ---------------------------------------------------------------------------

// "@me" references the authenticated user (the PAT owner). Passing a literal
// login makes `gh project` fail with "unknown owner type"; @me avoids that.
export const PROJECT_OWNER = process.env.GH_PROJECT_OWNER || "@me";
export const PROJECT_NUMBER = process.env.GH_PROJECT_NUMBER || "3";

function ghProjectJson(argv) {
  return JSON.parse(ghExec(argv));
}

let _projectMeta = null;

/**
 * Discover and cache the project's node id, the Status field id, and a
 * {columnName: optionId} map. Returns null if it can't be resolved.
 */
function getProjectMeta() {
  if (_projectMeta) return _projectMeta;
  try {
    const view = ghProjectJson(["project", "view", PROJECT_NUMBER, "--owner", PROJECT_OWNER, "--format", "json"]);
    const fieldsRaw = ghProjectJson(["project", "field-list", PROJECT_NUMBER, "--owner", PROJECT_OWNER, "--format", "json"]);
    const fields = Array.isArray(fieldsRaw) ? fieldsRaw : fieldsRaw.fields || [];
    const statusField = fields.find((f) => f.name === "Status");
    if (!view.id || !statusField || !statusField.id) {
      log("warn", "Board: could not resolve project id or Status field — skipping board updates.");
      return null;
    }
    const options = {};
    (statusField.options || []).forEach((o) => { options[o.name] = o.id; });
    _projectMeta = { projectId: view.id, statusFieldId: statusField.id, options };
    return _projectMeta;
  } catch (e) {
    log("warn", "Board: project discovery failed — skipping board updates.", errorData(e));
    return null;
  }
}

let _repoName = null;

function repoIssueUrl(issueNumber) {
  _repoName ??= ghProjectJson(["repo", "view", "--json", "nameWithOwner"]).nameWithOwner;
  return `https://github.com/${_repoName}/issues/${issueNumber}`;
}

/** Every item on the board, raw. Throws when gh fails or the listing was cut short. */
function readProjectItems() {
  const res = ghProjectJson([
    "project", "item-list", PROJECT_NUMBER, "--owner", PROJECT_OWNER, "--format", "json", "--limit", String(LISTING_LIMIT),
  ]);
  const items = res.items || [];
  rejectTruncated(items.length, "the board's items");
  return items;
}

/** Find the board item id for an issue number, or null if it isn't on the board. */
function findProjectItemId(issueNumber) {
  try {
    const items = readProjectItems();
    const match = items.find((it) => it.content && it.content.number === Number(issueNumber));
    return match ? match.id : null;
  } catch (e) {
    log("warn", `Board: could not list items for issue #${issueNumber}.`, errorData(e));
    return null;
  }
}

/**
 * List every board item with its column (Status). Returns
 * [{ number, title, status }] — number is null for draft items. Throws when the
 * board cannot be read: the PM dedups new tickets against these titles, and an
 * unreadable board is not an empty one.
 */
export function listProjectItems() {
  let items;
  try {
    items = readProjectItems();
  } catch (e) {
    throw new Error(`Could not list the board's items: ${e.message}`, { cause: e });
  }
  return items.map((it) => ({
    number: it.content && typeof it.content.number === "number" ? it.content.number : null,
    title: it.title || (it.content && it.content.title) || "(untitled)",
    status: it.status || "No Status",
  }));
}

/** Add an issue to the board; returns the item id (or null). Idempotent in effect. */
function addIssueToProject(issueNumber) {
  const existing = findProjectItemId(issueNumber);
  if (existing) return existing;
  try {
    const res = ghProjectJson([
      "project", "item-add", PROJECT_NUMBER, "--owner", PROJECT_OWNER, "--url", repoIssueUrl(issueNumber), "--format", "json",
    ]);
    log("info", `Board: added issue #${issueNumber}.`);
    return res.id || null;
  } catch (e) {
    log("warn", `Board: could not add issue #${issueNumber}.`, errorData(e));
    return null;
  }
}

/**
 * Move an issue's card to a named Status column (e.g. "In progress", "Done").
 * Adds the issue to the board first if needed. Best-effort; returns boolean.
 */
export function moveCard(issueNumber, statusName) {
  const meta = getProjectMeta();
  if (!meta) return false;
  const optionId = meta.options[statusName];
  if (!optionId) {
    log("warn", `Board: no column "${statusName}" — skipping move for #${issueNumber}.`);
    return false;
  }
  const itemId = addIssueToProject(issueNumber);
  if (!itemId) return false;
  try {
    ghExec([
      "project", "item-edit", "--id", itemId, "--project-id", meta.projectId,
      "--field-id", meta.statusFieldId, "--single-select-option-id", optionId,
    ]);
    log("info", `Board: moved issue #${issueNumber} → "${statusName}".`);
    return true;
  } catch (e) {
    log("warn", `Board: could not move issue #${issueNumber} to "${statusName}".`, errorData(e));
    return false;
  }
}

/** Take an issue's card off the board, if it has one. Best-effort; returns boolean. */
export function removeCard(issueNumber) {
  const itemId = findProjectItemId(issueNumber);
  if (!itemId) return false;
  try {
    ghExec(["project", "item-delete", PROJECT_NUMBER, "--owner", PROJECT_OWNER, "--id", itemId]);
    log("info", `Board: removed issue #${issueNumber}.`);
    return true;
  } catch (e) {
    log("warn", `Board: could not remove issue #${issueNumber}.`, errorData(e));
    return false;
  }
}
