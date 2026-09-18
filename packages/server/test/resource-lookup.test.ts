import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, test, mock } from 'node:test';
import type { Project } from '@openspace/shared';
import { projectsService } from '../src/config/projects-service.js';
import { closeAllDbs, closeProjectDb, listOpenDbs, openProjectDb } from '../src/db/index.js';
import { dbForResource } from '../src/routes/_helpers.js';

let root: string;
let projects: Project[];
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'openspace-lookup-'));
  projects = [];
  mock.method(projectsService, 'list', () => projects);
  mock.method(
    projectsService,
    'getByPath',
    (path: string) => projects.find((p) => p.workspace_path === path) ?? null,
  );
});
afterEach(() => {
  closeAllDbs();
  mock.restoreAll();
  rmSync(root, { recursive: true, force: true });
});
function addProject(id: string) {
  const project: Project = {
    id,
    name: id,
    workspace_path: join(root, id),
    display_name: null,
    goal: '',
    team_rules: null,
    color: null,
    created_at: 0,
  };
  projects.push(project);
  const db = openProjectDb(project.workspace_path);
  db.prepare('INSERT INTO channels (id, name, type, created_at) VALUES (?, ?, ?, ?)').run(
    id,
    id,
    'channel',
    0,
  );
  return project;
}

test('reopens a reclaimed database and finds the persisted channel', () => {
  const project = addProject('target');
  closeProjectDb(project.workspace_path);
  assert.equal(listOpenDbs().length, 0);
  const result = dbForResource('channels', 'target');
  assert.equal(result?.projectId, project.id);
  assert.ok(result?.db.open);
  assert.equal(dbForResource('channels', 'target')?.db, result?.db);
});

test('returns null for a genuinely missing resource after searching closed projects', () => {
  addProject('one');
  addProject('two');
  closeAllDbs();
  assert.equal(dbForResource('channels', 'missing'), null);
  assert.equal(listOpenDbs().length, 2);
});

test('finds a closed target with more registered projects than the pool limit', () => {
  addProject('target');
  for (let i = 0; i < 21; i++) addProject(`other-${i}`);
  assert.equal(
    listOpenDbs().some((p) => p.workspacePath.endsWith('/target')),
    false,
  );
  assert.equal(dbForResource('channels', 'target')?.projectId, 'target');
});

test('does not reopen projects removed from the registry', () => {
  addProject('removed');
  closeAllDbs();
  projects = [];
  assert.equal(dbForResource('channels', 'removed'), null);
  assert.equal(listOpenDbs().length, 0);
});

test('an inaccessible project does not hide another match or become a false not-found', () => {
  const broken = addProject('broken');
  addProject('target');
  closeAllDbs();
  rmSync(broken.workspace_path, { recursive: true });
  writeFileSync(broken.workspace_path, 'not a directory');
  assert.equal(dbForResource('channels', 'target')?.projectId, 'target');
  assert.throws(() => dbForResource('channels', 'missing'), AggregateError);
});
