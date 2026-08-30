import { readdir } from 'node:fs/promises';

/**
 * Documentation files, found the way a person finds them: by looking, not by
 * guessing the capitalisation. express keeps its readme in `Readme.md`, and
 * the first version of this reported the project as having no documentation
 * at all because the list said `README.md`.
 */
export async function findDocs(root, names) {
  const wanted = new Set(names.map((n) => n.toLowerCase()));
  const found = [];
  for (const dir of ['', 'docs', '.github']) {
    let entries;
    try {
      entries = await readdir(dir ? `${root}/${dir}` : root, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (!e.isFile()) continue;
      const rel = dir ? `${dir}/${e.name}` : e.name;
      if (wanted.has(rel.toLowerCase()) || wanted.has(e.name.toLowerCase())) found.push(rel);
    }
  }
  return found;
}
