import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type DatasetRoots, datasetMiddleware, listSources, resolveRoots } from '../server/dataset';
import { EXAMPLE } from './helpers';

const TORUS = 'torus__it000101__q0';

let tmp: string;
let roots: DatasetRoots;
let server: http.Server;
let base: string;

/**
 * Training holds one run (a copy of the example set); sample-events holds the
 * example plus a renamed copy — a folder name need not match the run inside.
 */
beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'grasp-ds-'));
  roots = { training: path.join(tmp, 'vr_failures'), sampleEvents: path.join(tmp, 'sample-events') };
  fs.cpSync(EXAMPLE, path.join(roots.training, 'grasp_pose_run1'), { recursive: true });
  fs.cpSync(EXAMPLE, path.join(roots.sampleEvents, 'example'), { recursive: true });
  fs.cpSync(EXAMPLE, path.join(roots.sampleEvents, 'hard_ones'), { recursive: true });
  fs.mkdirSync(path.join(roots.sampleEvents, 'not_a_run'));

  const middleware = datasetMiddleware(roots);
  server = http.createServer((req, res) =>
    middleware(req, res, () => {
      res.statusCode = 418;
      res.end();
    }),
  );
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/sources`;
});

afterEach(() => {
  server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const get = async (url: string) => (await fetch(`${base}${url}`)).json();
const post = (url: string, body: unknown) =>
  fetch(`${base}${url}`, { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) });
const demoFor = (run: string, caseId: string) => ({ schema: 'unitree-grasp-demo/v1', run, case_id: caseId, frames: [] });

describe('sources', () => {
  it('lists training first, then each sample-events folder that is a run', async () => {
    const sources = await get('');
    expect(sources.map((s: { id: string }) => s.id)).toEqual(['training', 'samples.example', 'samples.hard_ones']);
    expect(sources.map((s: { label: string }) => s.label)).toEqual(['TRAINING', 'EXAMPLE', 'HARD_ONES']);
    expect(sources.every((s: { cases: number }) => s.cases === 5)).toBe(true);
  });

  it('keeps an empty training source when the training repo has no output yet', () => {
    const sources = listSources({ training: path.join(tmp, 'missing'), sampleEvents: roots.sampleEvents });
    expect(sources[0]).toMatchObject({ id: 'training' });
    expect(sources[0].runs.size).toBe(0);
  });

  it('picks up folders added while the server runs', async () => {
    fs.cpSync(EXAMPLE, path.join(roots.sampleEvents, 'added_later'), { recursive: true });
    expect((await get('')).map((s: { id: string }) => s.id)).toContain('samples.added_later');
  });

  it('serves a sample folder under its folder name, whatever run it was copied from', async () => {
    const cases = await get('/samples.hard_ones/cases');
    expect(cases).toHaveLength(5);
    expect(cases.every((c: { run: string; source: string }) => c.run === 'hard_ones' && c.source === 'samples.hard_ones')).toBe(true);
    const c = await get(`/samples.hard_ones/cases/hard_ones/${TORUS}`);
    expect(c.run).toBe('hard_ones');
    const obj = await (await fetch(`${base}/samples.hard_ones/files/hard_ones/objects/torus.obj`)).text();
    expect(obj.startsWith('v ')).toBe(true);
  });

  it('serves training runs by run name', async () => {
    const cases = await get('/training/cases');
    expect(cases[0].run).toBe('grasp_pose_run1');
    expect((await get(`/training/cases/grasp_pose_run1/${TORUS}`)).case_id).toBe(TORUS);
  });

  it('rejects unknown sources and path traversal', async () => {
    expect((await fetch(`${base}/samples.nope/cases`)).status).toBe(404);
    expect((await fetch(`${base}/samples.example/files/example/..%2F..%2Fx`)).status).toBe(404);
    expect((await fetch(`${base}/samples.example/cases/..%2Ftraining/x`)).status).toBe(404);
    expect((await fetch(`${base.replace('/sources', '/other')}`)).status).toBe(404);
    expect((await fetch(`${base.replace('/api/sources', '/page')}`)).status).toBe(418);
  });
});

describe('demos', () => {
  it('saves into the source it was recorded against, and counts them', async () => {
    const res = await post(`/samples.example/demos/example/${TORUS}`, demoFor('example', TORUS));
    expect(res.status).toBe(201);
    expect((await res.json()).demos).toBe(1);
    expect(fs.readdirSync(path.join(roots.sampleEvents, 'example/demos', TORUS))).toHaveLength(1);
    expect(fs.existsSync(path.join(roots.training, 'grasp_pose_run1/demos'))).toBe(false);

    const cases = await get('/samples.example/cases');
    expect(cases.find((c: { case_id: string }) => c.case_id === TORUS).demos).toBe(1);
  });

  it('refuses demos that do not match their url or case', async () => {
    expect((await post(`/samples.example/demos/example/${TORUS}`, demoFor('example', 'other'))).status).toBe(400);
    expect((await post(`/samples.example/demos/example/nope`, demoFor('example', 'nope'))).status).toBe(404);
    expect((await post(`/samples.example/demos/example/${TORUS}`, '{not json')).status).toBe(400);
  });
});

describe('roots', () => {
  it('defaults to the sibling training repo and ./sample-events, with env overrides', () => {
    expect(resolveRoots('/x/app', {})).toEqual({
      training: '/x/unitree-grasping/data/vr_failures',
      sampleEvents: '/x/app/sample-events',
    });
    expect(resolveRoots('/x/app', { VR_DATASET_DIR: '/data', VR_SAMPLE_EVENTS_DIR: 'mine' })).toEqual({
      training: '/data',
      sampleEvents: '/x/app/mine',
    });
  });
});
