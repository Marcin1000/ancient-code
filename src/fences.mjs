import { walkFiles } from 'ancient-fences/src/walk.mjs';
import { detectFences } from 'ancient-fences/src/detect.mjs';
import { blameAll } from 'ancient-fences/src/age.mjs';
import { summarize } from 'ancient-fences/src/report.mjs';

/**
 * The scaffolding question, answered here instead of in a second command.
 *
 * This is the same scanner that ships as ancient-fences, imported rather than
 * reimplemented: two answers to the same question, drifting apart, would be
 * worse than no answer.
 */
export async function scanFences(root) {
  const skipped = [];
  const found = [];
  for await (const file of walkFiles(root, { skipped })) {
    found.push(...detectFences(file.path, file.text));
  }
  await blameAll(root, found);
  return {
    summary: { ...summarize(found, new Map()), skipped: skipped.length },
    items: found.map((f) => ({ file: f.file, line: f.line, kind: f.kind, premise: f.premise, lastTouched: f.lastTouched ?? null })),
  };
}
