import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import process from 'node:process';

const root = process.cwd();
const required = [
  'AGENTS.md',
  'CLAUDE.md',
  'docs/PLAN.md',
  'docs/DECISIONS.md',
  'docs/agents/README.md',
  'docs/agents/architecture.md',
  'docs/agents/workflow.md',
  'docs/agents/review.md',
  'docs/agents/delegation.md',
  '.agents/skills/pollyroll-development/SKILL.md',
  '.agents/skills/pollyroll-physics/SKILL.md',
  '.agents/skills/pollyroll-webgl/SKILL.md',
  '.agents/skills/pollyroll-visual-tests/SKILL.md',
  '.agents/skills/pollyroll-size-bakeoff/SKILL.md',
  '.agents/skills/pollyroll-concise-code/SKILL.md',
  '.agents/skills/THIRD_PARTY.md',
  '.claude/agents/pr-implementer.md',
  '.claude/agents/pr-transcriber.md',
  '.claude/agents/pr-task-reviewer.md',
  '.claude/agents/pr-branch-reviewer.md',
];
const errors = [];
const contents = new Map();

for (const path of required) {
  try {
    contents.set(path, await readFile(resolve(root, path), 'utf8'));
  } catch {
    errors.push(`Missing required agent file: ${path}`);
  }
}

const markdownLink = /\[[^\]]+\]\((?!https?:|#)([^)]+\.md)(?:#[^)]+)?\)/g;
for (const [source, content] of contents) {
  for (const match of content.matchAll(markdownLink)) {
    try {
      await readFile(resolve(root, dirname(source), match[1]), 'utf8');
    } catch {
      errors.push(`Broken Markdown link in ${source}: ${match[1]}`);
    }
  }
}

const delegation = contents.get('docs/agents/delegation.md') ?? '';
for (const path of required.filter((p) => p.startsWith('.claude/agents/'))) {
  const content = contents.get(path) ?? '';
  const name = content.match(/^name:\s*(\S+)/m)?.[1];
  const model = content.match(/^model:\s*(\S+)/m)?.[1];
  if (!name || !model) {
    errors.push(`Agent definition missing name or model: ${path}`);
    continue;
  }
  if (!delegation.includes(`\`${name}\``) || !delegation.includes(`\`${model}\``)) {
    errors.push(`delegation.md does not list agent ${name} with model ${model}`);
  }
}

const attribution = /co-authored-by|generated with \[?claude/i;
for (const [source, content] of contents) {
  if (attribution.test(content) && !/no `?co-authored-by/i.test(content)) {
    errors.push(`Attribution text found in ${source}`);
  }
}

try {
  const manifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
  if (manifest.name !== 'pollyroll') errors.push(`package.json name is ${manifest.name}`);
  const runtimeDeps = Object.keys(manifest.dependencies ?? {});
  if (runtimeDeps.length)
    errors.push(`Runtime dependencies are forbidden: ${runtimeDeps.join(', ')}`);
} catch (error) {
  if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT'))
    throw error;
}

if (errors.length) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`Agent tooling OK: ${required.length} files.`);
}
