// The board and backlog rendered as text for the PM, PO and Tech Lead.

import { AGENT_LABEL, isConfirmedRetired, isManualIssue, labelNames, retiredDependencies } from "./backlog.mjs";
import { listProjectItems } from "./board.mjs";
import { fetchOpenIssues } from "./github.mjs";

// ---------------------------------------------------------------------------
// Shared snapshots (used by both the Product Owner and Product Manager)
// ---------------------------------------------------------------------------

// How many shipped tickets the board text lists by title. Done is the one column
// that only ever grows, and the whole of it went into the PM, PO and Tech Lead
// prompts every run — 100+ titles and climbing, the same unbounded growth the
// Changelog trim fixed, paid in every session's context and every session's
// time. The recent ones are what those prompts actually reason from: what just
// shipped, and what the next ticket should deepen. Whether something older was
// already BUILT is answered from docs/, which the PM reads before keeping a
// ticket, not from a title list.
export const RECENT_DONE_SHOWN = 30;

/**
 * Snapshot of the project's tickets: live open issues, raw board items, and a
 * human-readable board grouped by column (see formatBoardState).
 */
export function getBoardSnapshot() {
  const openIssues = fetchOpenIssues();
  const boardItems = listProjectItems();
  return { openIssues, boardItems, boardState: formatBoardState(boardItems, openIssues) };
}

/**
 * The board as prompt text, grouped by column, with any un-boarded open issues
 * folded into a "Todo (not yet on board)" group so nothing is invisible. Every
 * column is listed in full except Done, which lists its RECENT_DONE_SHOWN most
 * recent tickets and counts the rest.
 *
 * "Recent" is the highest issue number. The board listing carries no dates, and
 * fetching every closed issue's closedAt would add a listing that grows exactly
 * like the one this trims; tickets are built within days of being filed, so
 * filing order is shipping order closely enough for context. Draft items have
 * no number and sort as oldest.
 */
export function formatBoardState(boardItems, openIssues, isRetired = isConfirmedRetired) {
  // Labels per open ticket (so the board shows priority / tech-debt tags).
  //
  // The `agent` marker itself is plumbing and stays hidden — but its ABSENCE is
  // the only signal that a person filed the ticket, and hiding the label hid that
  // too. So it is inverted into something the reader can act on: an agent ticket
  // gets no marker, a human one says so.
  const labelsByNumber = new Map(
    openIssues.map((issue) => {
      const visible = labelNames(issue).filter((name) => name !== AGENT_LABEL);
      return [issue.number, isManualIssue(issue) ? [...visible, "from a person"] : visible];
    })
  );
  const tag = (num) => {
    const labs = num != null ? labelsByNumber.get(num) || [] : [];
    return labs.length ? ` _(${labs.join(", ")})_` : "";
  };
  // A `waiting` tag alone reads as "not yet", and a ticket waiting on a retired
  // prerequisite is "never": the card says which one, so the reader can act.
  const openNumbers = new Set(openIssues.map((i) => i.number));
  const openByNumber = new Map(openIssues.map((i) => [i.number, i]));
  const retiredNote = (num) => {
    const retired = openByNumber.has(num) ? retiredDependencies(openByNumber.get(num), openNumbers, isRetired) : [];
    return retired.length ? ` — waits on ${retired.map((n) => `#${n}`).join(", ")}, retired without shipping` : "";
  };
  const line = (i) => `- ${i.number ? "#" + i.number + " " : ""}${i.title}${tag(i.number)}${retiredNote(i.number)}`;

  const groups = {};
  for (const it of boardItems) (groups[it.status] ||= []).push(it);
  const onBoard = new Set(boardItems.map((i) => i.number).filter((n) => n != null));
  for (const iss of openIssues) {
    if (!onBoard.has(iss.number)) {
      (groups["Todo (not yet on board)"] ||= []).push({ number: iss.number, title: iss.title });
    }
  }
  if (!Object.keys(groups).length) return "(no tickets yet — the board is empty)";

  return Object.entries(groups)
    .map(([status, list]) => {
      const lines = status === "Done" ? recentDoneLines(list, line) : list.map(line);
      return `**${status}** (${list.length}):\n` + lines.join("\n");
    })
    .join("\n\n");
}

function recentDoneLines(done, line) {
  const newestFirst = [...done].sort((a, b) => (b.number ?? 0) - (a.number ?? 0));
  const lines = newestFirst.slice(0, RECENT_DONE_SHOWN).map(line);
  const earlier = newestFirst.length - RECENT_DONE_SHOWN;
  if (earlier > 0) lines.push(`- …and ${earlier} more shipped earlier`);
  return lines;
}
