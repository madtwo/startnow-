import type { Comment } from '../types';

/** Forum data keeps the full replyTo chain; the visual rail stops after two levels. */
export const MAX_VISUAL_REPLY_DEPTH = 2;

export interface ThreadRow {
  comment: Comment;
  parent?: Comment;
  /** Depth of the original reply tree; never persisted or used as an indent. */
  depth: number;
  visualDepth: 0 | 1 | 2;
}

/**
 * Present a reply tree as flat, accessible forum floors. Iterative traversal avoids
 * truncating deep conversations or recursively nesting DOM nodes indefinitely.
 * Missing parents are roots; malformed cycles are displayed once rather than hidden.
 */
export function orderThreadComments(comments: readonly Comment[]): ThreadRow[] {
  const byId = new Map<string, Comment>();
  for (const comment of comments) if (!byId.has(comment.id)) byId.set(comment.id, comment);

  const children = new Map<string, Comment[]>();
  const roots: Comment[] = [];
  for (const comment of byId.values()) {
    const parentId = comment.replyTo;
    if (!parentId || parentId === comment.id || !byId.has(parentId)) {
      roots.push(comment);
      continue;
    }
    const siblings = children.get(parentId) ?? [];
    siblings.push(comment);
    children.set(parentId, siblings);
  }

  const result: ThreadRow[] = [];
  const visited = new Set<string>();
  const visit = (start: Comment) => {
    const stack: { comment: Comment; depth: number }[] = [{ comment: start, depth: 0 }];
    while (stack.length > 0) {
      const entry = stack.pop()!;
      const comment = entry.comment;
      if (visited.has(comment.id)) continue;
      visited.add(comment.id);
      const parent = comment.replyTo && comment.replyTo !== comment.id
        ? byId.get(comment.replyTo)
        : undefined;
      result.push({
        comment, parent, depth: entry.depth,
        visualDepth: Math.min(entry.depth, MAX_VISUAL_REPLY_DEPTH) as 0 | 1 | 2,
      });
      const kids = children.get(comment.id) ?? [];
      for (let i = kids.length - 1; i >= 0; i--) {
        stack.push({ comment: kids[i], depth: entry.depth + 1 });
      }
    }
  };
  roots.forEach(visit);
  // Imported archives can contain cycles. Ensure they do not hide replies.
  for (const comment of byId.values()) if (!visited.has(comment.id)) visit(comment);
  return result;
}

/** The latest message is identified by insertion order, not by DOM position in a tree. */
export function latestCommentId(comments: readonly Comment[]): string | undefined {
  return comments[comments.length - 1]?.id;
}
