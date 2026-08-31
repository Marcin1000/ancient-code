/**
 * The library entry point, so that anything else can ask the same questions
 * the command line asks. The command line stays the reference implementation:
 * everything here is what `ancient-code .` already runs.
 */
export { ownership, ownershipRisk } from './ownership.mjs';
export { safetyNet } from './safety.mjs';
export { buildability } from './buildability.mjs';
export { docsReality } from './docsreality.mjs';
export { scanFences } from './fences.mjs';
export { runBuild } from './buildrun.mjs';
export { assess, renderText, renderHtml, CRITERIA } from './report.mjs';
export { projectName } from './name.mjs';
