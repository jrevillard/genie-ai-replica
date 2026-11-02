/**
 * frontmatterMerge — pure helper for the per-repo frontmatter write-through.
 *
 * Story 1.7 (2026-10-08, supersedes the Story 1.6 dedicated collection):
 * the per-repo frontmatter lives in two places that stay in sync via
 * write-through:
 *   1. The OKF repo's index.md YAML frontmatter block — curator-facing
 *      projection, edited in the markdown editor.
 *   2. okf_repositories.frontmatter (a new doc field) — canonical store
 *      read by the retriever + the publish gate.
 *
 * This helper produces the new index.md markdown for save: parse the
 * current markdown, replace the `frontmatter:` sub-block with the
 * approved set, preserve everything else (type / title / labels / links
 * / description / body), re-serialize. Pure function — testable in
 * isolation, no store or component dependencies.
 *
 * The shape passed in is the per-repo frontmatter object:
 *   { topic: string[], entity: string[], scope: string,
 *     forbidden: string[], summary: string, keyword: string[] }
 * — the same shape the server's `writeFrontmatterToRepoDoc` writes to
 * okf_repositories.frontmatter. The `frontmatter._approved` list stays
 * in the doc field (server-side), NOT in the YAML — the publish gate
 * reads it from there.
 */
import matter from 'gray-matter';

export function mergeFrontmatterIntoIndexMarkdown(markdown, shape) {
  const parsed = matter(markdown || '');
  const existing = parsed.data || {};
  const nextFm = {
    ...existing,
    frontmatter: {
      topic: Array.isArray(shape.topic) ? shape.topic : [],
      entity: Array.isArray(shape.entity) ? shape.entity : [],
      scope: typeof shape.scope === 'string' ? shape.scope : '',
      forbidden: Array.isArray(shape.forbidden) ? shape.forbidden : [],
      summary: typeof shape.summary === 'string' ? shape.summary : '',
      keyword: Array.isArray(shape.keyword) ? shape.keyword : []
    }
  };
  return matter.stringify(parsed.content || '', nextFm);
}
