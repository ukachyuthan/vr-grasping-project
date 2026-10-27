import type { CaseSummary, CaseVerdict, Demo, FailureCase, SourceInfo, Verdict } from './types';

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 120)}`);
  return res.json() as Promise<T>;
}

const enc = encodeURIComponent;
const base = (source: string) => `/api/sources/${enc(source)}`;

export async function fetchSources(): Promise<SourceInfo[]> {
  return json(await fetch('/api/sources'));
}

export async function fetchCases(source: string): Promise<CaseSummary[]> {
  return json(await fetch(`${base(source)}/cases`));
}

export async function fetchCase(source: string, run: string, caseId: string): Promise<FailureCase> {
  return json(await fetch(`${base(source)}/cases/${enc(run)}/${enc(caseId)}`));
}

/** The case's mesh as OBJ text, or null when the case has none. */
export async function fetchMesh(source: string, c: FailureCase): Promise<string | null> {
  if (!c.object.mesh) return null;
  const res = await fetch(`${base(source)}/files/${enc(c.run)}/${c.object.mesh}`);
  if (!res.ok) throw new Error(`mesh ${c.object.mesh}: ${res.status}`);
  return res.text();
}

export async function saveVerdict(source: string, run: string, caseId: string, verdict: Verdict): Promise<CaseVerdict> {
  const url = `${base(source)}/verdicts/${enc(run)}/${enc(caseId)}`;
  return json(
    await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ verdict }) }),
  );
}

export async function saveDemo(source: string, demo: Demo): Promise<{ saved: string; demos: number }> {
  const url = `${base(source)}/demos/${enc(demo.run)}/${enc(demo.case_id)}`;
  return json(
    await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(demo) }),
  );
}
