// GitHub Discussions — where the pipeline talks to a person.
//
// Two things it publishes are not work and never become work: the weekly digest,
// and a health alert. Both were issues, because an issue was the only primitive
// reached for. Both were wrong in the same way.
//
// The digest was created and closed in the same breath, which is a broadcast
// wearing a task's clothes: the close existed only to stop an open issue
// addressed to a human from looking like a human on the critical path. And a
// health alert describes the PIPELINE, which nothing in docs/ can fix — the Devs
// picked one up and tried to build it, which is why isBuildable has to know about
// labels that mean "not actually a request".
//
// A discussion is the primitive both wanted: a post, not a task. It carries no
// board card, no priority, nothing the Devs will ever pick up, and — unlike the
// issue-then-close trick — it still has an open/closed state, so an alert can
// clear itself when the thing it reported is fixed.
//
// Discussions are GraphQL-only. Everything below is a thin wrapper over one
// mutation or query, and every string that could contain model-written text is
// passed as a VARIABLE rather than interpolated into the document.
import { execFileSync } from "child_process";
import { log, errorData } from "./log.mjs";
import { repoRoot } from "./shared.mjs";

const OWNER = process.env.GITHUB_REPOSITORY_OWNER || "";

/**
 * Run one GraphQL document with variables.
 *
 * execFileSync, not execSync, and that is not a style preference. A GraphQL
 * document is full of `$variable` declarations, and passing one through a shell
 * lets the shell expand them first — `query($owner: String!)` arrives at GitHub as
 * `query(: String!)` and is rejected with a parse error that names a colon and
 * explains nothing. Passing argv directly means no shell, so no expansion, and
 * no quoting rules to get wrong on a body a model wrote.
 */
function graphql(query, variables = {}) {
  const args = ["api", "graphql", "-f", `query=${query}`];
  for (const [key, value] of Object.entries(variables)) {
    // -F types its values (true, 123, null); -f keeps them as strings, which is
    // what every variable here is.
    args.push("-f", `${key}=${value}`);
  }
  return JSON.parse(
    execFileSync("gh", args, { cwd: repoRoot, maxBuffer: 10 * 1024 * 1024 }).toString()
  );
}

/** The repository and the category to post in, resolved together. */
function resolveTarget(categoryName) {
  const repo = process.env.GITHUB_REPOSITORY || "";
  const [owner, name] = repo.includes("/") ? repo.split("/") : [OWNER, ""];
  const result = graphql(
    `query($owner: String!, $name: String!) {
       repository(owner: $owner, name: $name) {
         id
         discussionCategories(first: 25) { nodes { id name } }
       }
     }`,
    { owner, name }
  );
  const repository = result?.data?.repository;
  if (!repository) return null;
  const category = repository.discussionCategories.nodes.find((c) => c.name === categoryName);
  if (!category) {
    log("warn", `Discussions: no "${categoryName}" category in this repository.`);
    return null;
  }
  return { repositoryId: repository.id, categoryId: category.id };
}

/**
 * Post a discussion. Returns its URL, or null — never throws, because nothing
 * that publishes a report should be able to fail the run that produced it.
 */
export function postDiscussion({ category, title, body }) {
  try {
    const target = resolveTarget(category);
    if (!target) return null;
    const result = graphql(
      `mutation($repositoryId: ID!, $categoryId: ID!, $title: String!, $body: String!) {
         createDiscussion(input: {
           repositoryId: $repositoryId, categoryId: $categoryId, title: $title, body: $body
         }) { discussion { url number } }
       }`,
      { ...target, title, body }
    );
    const discussion = result?.data?.createDiscussion?.discussion;
    if (!discussion) {
      log("warn", "Discussions: the post was rejected.", { result });
      return null;
    }
    log("info", `Discussions: posted ${discussion.url}`);
    return discussion.url;
  } catch (e) {
    log("warn", `Discussions: could not post "${title}".`, errorData(e));
    return null;
  }
}

/**
 * The open discussion whose title starts with `prefix`, if there is one.
 *
 * This is how an alert avoids repeating itself: one open post per ongoing
 * problem, rather than a new one every day the problem persists.
 */
export function findOpenDiscussion(category, prefix) {
  try {
    const repo = process.env.GITHUB_REPOSITORY || "";
    const [owner, name] = repo.includes("/") ? repo.split("/") : [OWNER, ""];
    const result = graphql(
      `query($owner: String!, $name: String!) {
         repository(owner: $owner, name: $name) {
           discussions(first: 25, orderBy: {field: CREATED_AT, direction: DESC}) {
             nodes { id number title url closed category { name } }
           }
         }
       }`,
      { owner, name }
    );
    const nodes = result?.data?.repository?.discussions?.nodes || [];
    return nodes.find((d) => !d.closed && d.category?.name === category && d.title.startsWith(prefix)) || null;
  } catch (e) {
    log("warn", "Discussions: could not read existing posts.", errorData(e));
    return null;
  }
}

/**
 * Close a discussion because what it reported is no longer true.
 *
 * The reason an alert has a lifecycle at all: a monitoring signal that cannot
 * clear itself becomes a stale page nobody trusts, and the health alert used to
 * be exactly that — filed once, never closed, and silently suppressing every
 * later alert for as long as it stayed open.
 */
export function resolveDiscussion(discussionId, comment) {
  try {
    if (comment) {
      graphql(
        `mutation($discussionId: ID!, $body: String!) {
           addDiscussionComment(input: {discussionId: $discussionId, body: $body}) { comment { id } }
         }`,
        { discussionId, body: comment }
      );
    }
    graphql(
      `mutation($discussionId: ID!) {
         closeDiscussion(input: {discussionId: $discussionId, reason: RESOLVED}) { discussion { number } }
       }`,
      { discussionId }
    );
    log("info", "Discussions: closed a resolved post.");
    return true;
  } catch (e) {
    log("warn", "Discussions: could not close a post.", errorData(e));
    return false;
  }
}
