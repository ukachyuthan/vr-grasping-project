/**
 * Serves failure cases to the headset and stores demos back next to them.
 *
 * Cases come from *sources*, which the menu's SOURCE button cycles through:
 *
 *   training              the training repo's data/vr_failures/, one folder per run
 *   samples.<name>        each folder in sample-events/, laid out like ONE run
 *                         folder (manifest.json, cases/, objects/) — so a run from
 *                         training can be copied in as-is to keep it as a scenario
 *
 * Sources are re-scanned on every request, so folders added while the server
 * runs show up on the next SOURCE press. Only each run's `demos/` folder is
 * written to; manifest.json belongs to whoever produced the run.
 *
 *   GET  /api/sources                              every source, with case counts
 *   GET  /api/sources/:src/cases                   that source's cases
 *   GET  /api/sources/:src/cases/:run/:case        one case
 *   GET  /api/sources/:src/files/:run/<path>       a file inside a run (meshes)
 *   POST /api/sources/:src/demos/:run/:case        save a demo JSON
 *   POST /api/sources/:src/verdicts/:run/:case     save the case's verdict (e.g. impossible)
 *
 * Verdicts live in <run>/verdicts/<case>.json, one per case, latest wins.
 */
import fs from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import type { Plugin } from 'vite';
import type { CaseSummary, CaseVerdict, FailureCase, SourceInfo, Verdict } from '../src/data/types';

const SEGMENT = /^[A-Za-z0-9_.-]+$/;
const MAX_DEMO_BYTES = 32 * 1024 * 1024;
const SAMPLE_PREFIX = 'samples.';

export interface DatasetRoots {
  /** Training output: a folder of run folders. */
  training: string;
  /** Folder of scenario sets, each laid out like a single run folder. */
  sampleEvents: string;
}

interface Source {
  id: string;
  label: string;
  root: string;
  /** Run name → run folder. */
  runs: Map<string, string>;
}

export function isSafeSegment(s: string): boolean {
  return SEGMENT.test(s) && s !== '.' && s !== '..';
}

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8')) as T;
  } catch {
    return null;
  }
}

function subdirs(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && isSafeSegment(d.name))
      .map((d) => d.name)
      .sort();
  } catch {
    return [];
  }
}

const isRun = (dir: string) => fs.existsSync(path.join(dir, 'manifest.json'));

/** Training first, then sample-event sets alphabetically. */
export function listSources(roots: DatasetRoots): Source[] {
  const training = new Map<string, string>();
  for (const run of subdirs(roots.training)) {
    const dir = path.join(roots.training, run);
    if (isRun(dir)) training.set(run, dir);
  }
  const sources: Source[] = [{ id: 'training', label: 'TRAINING', root: roots.training, runs: training }];

  for (const name of subdirs(roots.sampleEvents)) {
    const dir = path.join(roots.sampleEvents, name);
    if (!isRun(dir)) continue;
    sources.push({ id: `${SAMPLE_PREFIX}${name}`, label: name.toUpperCase(), root: dir, runs: new Map([[name, dir]]) });
  }
  return sources;
}

function findSource(roots: DatasetRoots, id: string): Source | null {
  return listSources(roots).find((s) => s.id === id) ?? null;
}

function countDemos(runDir: string, caseId: string): number {
  try {
    return fs.readdirSync(path.join(runDir, 'demos', caseId)).filter((f) => f.endsWith('.json')).length;
  } catch {
    return 0;
  }
}

function readVerdict(runDir: string, caseId: string): Verdict | null {
  return readJson<CaseVerdict>(path.join(runDir, 'verdicts', `${caseId}.json`))?.verdict ?? null;
}

/**
 * Cases held out from demonstration by the run's split.json
 * (unitree-grasping scripts/split_failure_cases.py): never shown, so they stay
 * an honest test of whether demos on other cases generalize.
 */
function heldOut(runDir: string): Set<string> {
  return new Set(readJson<{ heldout?: string[] }>(path.join(runDir, 'split.json'))?.heldout ?? []);
}

export function listCases(source: Source): CaseSummary[] {
  const out: CaseSummary[] = [];
  for (const [run, dir] of source.runs) {
    const manifest = readJson<{ cases: Omit<CaseSummary, 'run' | 'demos' | 'source' | 'verdict'>[] }>(
      path.join(dir, 'manifest.json'),
    );
    const hidden = heldOut(dir);
    for (const c of manifest?.cases ?? []) {
      if (hidden.has(c.case_id)) continue;
      out.push({
        ...c,
        source: source.id,
        run,
        demos: countDemos(dir, c.case_id),
        verdict: readVerdict(dir, c.case_id),
      });
    }
  }
  // Newest runs first, and within a run the latest failures first.
  return out.sort((a, b) => b.run.localeCompare(a.run) || b.iteration - a.iteration);
}

export function sourceInfo(source: Source): SourceInfo {
  return { id: source.id, label: source.label, root: source.root, cases: listCases(source).length };
}

/**
 * The case, with `run` set to the folder it was served from: a sample folder may
 * be a renamed copy of a training run, and the app addresses it by folder.
 */
export function readCase(source: Source, run: string, caseId: string): FailureCase | null {
  const dir = source.runs.get(run);
  if (!dir || !isSafeSegment(caseId) || heldOut(dir).has(caseId)) return null;
  const c = readJson<FailureCase>(path.join(dir, 'cases', `${caseId}.json`));
  return c ? { ...c, run } : null;
}

/** Absolute path of a file inside a run, or null if it would escape the run. */
export function resolveRunFile(source: Source, run: string, rel: string): string | null {
  const dir = source.runs.get(run);
  if (!dir) return null;
  const runDir = path.resolve(dir);
  const file = path.resolve(runDir, rel);
  if (!file.startsWith(runDir + path.sep)) return null;
  return fs.existsSync(file) && fs.statSync(file).isFile() ? file : null;
}

export function saveDemo(source: Source, run: string, caseId: string, demo: unknown): { saved: string; demos: number } {
  if (!readCase(source, run, caseId)) throw new HttpError(404, `unknown case ${run}/${caseId}`);
  const d = demo as { schema?: string; case_id?: string; run?: string };
  if (d?.schema !== 'unitree-grasp-demo/v1') throw new HttpError(400, 'not a unitree-grasp-demo/v1');
  if (d.case_id !== caseId || d.run !== run) throw new HttpError(400, 'demo does not match its URL');

  const runDir = source.runs.get(run)!;
  const dir = path.join(runDir, 'demos', caseId);
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  let file = path.join(dir, `${stamp}.json`);
  for (let i = 2; fs.existsSync(file); i++) file = path.join(dir, `${stamp}_${i}.json`);
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(demo));
  fs.renameSync(`${file}.tmp`, file);
  return { saved: path.relative(runDir, file), demos: countDemos(runDir, caseId) };
}

const VERDICTS: Verdict[] = ['impossible', 'feasible'];

export function saveVerdict(source: Source, run: string, caseId: string, body: unknown): CaseVerdict {
  const c = readCase(source, run, caseId);
  if (!c) throw new HttpError(404, `unknown case ${run}/${caseId}`);
  const verdict = (body as { verdict?: Verdict })?.verdict;
  if (!verdict || !VERDICTS.includes(verdict)) throw new HttpError(400, `verdict must be one of ${VERDICTS}`);

  const record: CaseVerdict = {
    schema: 'unitree-grasp-verdict/v1',
    run,
    case_id: caseId,
    shape: c.object.shape,
    verdict,
    created_at: new Date().toISOString(),
  };
  const dir = path.join(source.runs.get(run)!, 'verdicts');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${caseId}.json`);
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(record));
  fs.renameSync(`${file}.tmp`, file);
  return record;
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function send(res: ServerResponse, status: number, body: unknown, type = 'application/json') {
  res.statusCode = status;
  res.setHeader('Content-Type', type);
  res.setHeader('Cache-Control', 'no-store');
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_DEMO_BYTES) {
        reject(new HttpError(413, 'demo too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

/**
 * The live robot check runs in the training repo's sim
 * (scripts/grasp_check_server.py); VR_CHECK_URL overrides where.
 */
const checkUrl = () => process.env.VR_CHECK_URL ?? 'http://127.0.0.1:8765/check';

async function forwardCheck(body: string, res: ServerResponse) {
  const url = checkUrl();
  let upstream: Response;
  try {
    upstream = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal: AbortSignal.timeout(60000),
    });
  } catch (error) {
    return send(res, 503, { error: `robot check offline (${url}): ${(error as Error).message}` });
  }
  return send(res, upstream.status, await upstream.text());
}

export function datasetMiddleware(roots: DatasetRoots) {
  return async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const url = new URL(req.url ?? '/', 'http://local');
    if (!url.pathname.startsWith('/api/')) return next();
    const parts = url.pathname.split('/').slice(2).map(decodeURIComponent);

    try {
      if (req.method === 'POST' && parts[0] === 'check' && parts.length === 1) {
        return await forwardCheck(await readBody(req), res);
      }
      if (parts[0] !== 'sources') return send(res, 404, { error: 'no such endpoint' });
      if (req.method === 'GET' && parts.length === 1) {
        return send(res, 200, listSources(roots).map(sourceInfo));
      }
      const source = findSource(roots, parts[1] ?? '');
      if (!source) return send(res, 404, { error: `unknown source ${parts[1]}` });
      const [, , kind, run, ...rest] = parts;

      if (req.method === 'GET' && kind === 'cases' && parts.length === 3) {
        return send(res, 200, listCases(source));
      }
      if (req.method === 'GET' && kind === 'cases' && rest.length === 1) {
        const c = readCase(source, run, rest[0]);
        return c ? send(res, 200, c) : send(res, 404, { error: 'case not found' });
      }
      if (req.method === 'GET' && kind === 'files' && rest.length >= 1) {
        const file = resolveRunFile(source, run, rest.join('/'));
        if (!file) return send(res, 404, { error: 'file not found' });
        return send(res, 200, fs.readFileSync(file), 'text/plain; charset=utf-8');
      }
      if (req.method === 'POST' && kind === 'demos' && rest.length === 1) {
        const demo = JSON.parse(await readBody(req));
        return send(res, 201, saveDemo(source, run, rest[0], demo));
      }
      if (req.method === 'POST' && kind === 'verdicts' && rest.length === 1) {
        const body = JSON.parse(await readBody(req));
        return send(res, 201, saveVerdict(source, run, rest[0], body));
      }
      return send(res, 404, { error: 'no such endpoint' });
    } catch (error) {
      const status = error instanceof HttpError ? error.status : error instanceof SyntaxError ? 400 : 500;
      return send(res, status, { error: (error as Error).message });
    }
  };
}

export function datasetPlugin(roots: DatasetRoots): Plugin {
  const middleware = datasetMiddleware(roots);
  return {
    name: 'grasp-dataset-api',
    configureServer(server) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    },
  };
}

/**
 * VR_DATASET_DIR overrides the training output (default: the sibling training
 * repo); VR_SAMPLE_EVENTS_DIR overrides ./sample-events. Missing folders are
 * fine — a source with nothing in it just shows 0 cases.
 */
export function resolveRoots(cwd: string, env = process.env): DatasetRoots {
  return {
    training: path.resolve(cwd, env.VR_DATASET_DIR ?? '../unitree-grasping/data/vr_failures'),
    sampleEvents: path.resolve(cwd, env.VR_SAMPLE_EVENTS_DIR ?? 'sample-events'),
  };
}
