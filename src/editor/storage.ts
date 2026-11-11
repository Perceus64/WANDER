// Local persistence: IndexedDB for projects, binary assets and version history;
// zip archives for import/export. No server involved.
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { migrate, uid, type Project } from '../engine/types';

const DB = 'wander', VER = 1;
let dbp: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  dbp ??= new Promise((res, rej) => {
    const r = indexedDB.open(DB, VER);
    r.onupgradeneeded = () => {
      const d = r.result;
      d.createObjectStore('projects', { keyPath: 'id' });
      d.createObjectStore('blobs');
      d.createObjectStore('versions', { keyPath: 'key' }).createIndex('pid', 'pid');
      d.createObjectStore('meta');
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}

const req = <T>(r: IDBRequest<T>) => new Promise<T>((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const done = (t: IDBTransaction) => new Promise<void>((res, rej) => { t.oncomplete = () => res(); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error); });
const range = (pid: string) => IDBKeyRange.bound(`${pid}|`, `${pid}|￿`);

export interface ProjectInfo { id: string; name: string; modified: number; thumbnail?: string; objects: number }

export async function listProjects(): Promise<ProjectInfo[]> {
  const all: Project[] = await req((await db()).transaction('projects').objectStore('projects').getAll());
  return all.map((p) => ({ id: p.id, name: p.name, modified: p.modified, thumbnail: p.thumbnail, objects: Object.keys(p.scene.objects).length })).sort((a, b) => b.modified - a.modified);
}

/** Save the project record and the given blobs. `keep` lists every blob key that should survive. */
export async function putProject(p: Project, blobs: Map<string, Blob>, keep: Set<string>) {
  const d = await db();
  const t = d.transaction(['projects', 'blobs'], 'readwrite');
  t.objectStore('projects').put(p);
  const bs = t.objectStore('blobs');
  for (const [k, b] of blobs) bs.put(b, `${p.id}|${k}`);
  const keys = await req(bs.getAllKeys(range(p.id)));
  for (const k of keys) if (!keep.has(String(k).slice(p.id.length + 1))) bs.delete(k);
  await done(t);
}

export async function getProject(id: string): Promise<{ project: Project; blobs: Map<string, Blob> } | null> {
  const d = await db();
  const t = d.transaction(['projects', 'blobs']);
  const p = await req(t.objectStore('projects').get(id));
  if (!p) return null;
  const bs = t.objectStore('blobs');
  const [keys, vals] = await Promise.all([req(bs.getAllKeys(range(id))), req(bs.getAll(range(id)))]);
  const blobs = new Map<string, Blob>();
  keys.forEach((k, i) => blobs.set(String(k).slice(id.length + 1), vals[i]));
  return { project: migrate(p), blobs };
}

export async function deleteProject(id: string) {
  const d = await db();
  const t = d.transaction(['projects', 'blobs', 'versions'], 'readwrite');
  t.objectStore('projects').delete(id);
  t.objectStore('blobs').delete(range(id));
  const vs = await req(t.objectStore('versions').index('pid').getAllKeys(id));
  vs.forEach((k) => t.objectStore('versions').delete(k));
  await done(t);
}

export async function duplicateProject(id: string): Promise<string | null> {
  const src = await getProject(id);
  if (!src) return null;
  const p = structuredClone(src.project);
  p.id = uid('p'); p.name += ' (copy)'; p.created = p.modified = Date.now();
  await putProject(p, src.blobs, new Set(src.blobs.keys()));
  return p.id;
}

export async function renameProject(id: string, name: string) {
  const d = await db();
  const t = d.transaction('projects', 'readwrite');
  const p = await req(t.objectStore('projects').get(id));
  if (p) { p.name = name; t.objectStore('projects').put(p); }
  await done(t);
}

export interface VersionInfo { key: string; pid: string; time: number; label: string }

export async function addVersion(p: Project, label: string) {
  const d = await db();
  const t = d.transaction('versions', 'readwrite');
  const s = t.objectStore('versions');
  s.put({ key: `${p.id}|${Date.now()}`, pid: p.id, time: Date.now(), label, data: JSON.stringify(p) });
  const keys = await req(s.index('pid').getAllKeys(p.id));
  keys.slice(0, Math.max(0, keys.length - 15)).forEach((k) => s.delete(k));
  await done(t);
}

export async function listVersions(pid: string): Promise<VersionInfo[]> {
  const all = await req((await db()).transaction('versions').objectStore('versions').index('pid').getAll(pid));
  return all.map(({ key, pid, time, label }: any) => ({ key, pid, time, label })).reverse();
}

export async function getVersion(key: string): Promise<Project | null> {
  const v = await req((await db()).transaction('versions').objectStore('versions').get(key));
  return v ? migrate(JSON.parse(v.data)) : null;
}

export async function setMeta(key: string, value: any) {
  const t = (await db()).transaction('meta', 'readwrite');
  t.objectStore('meta').put(value, key);
  await done(t);
}
export async function getMeta<T>(key: string): Promise<T | undefined> {
  return req((await db()).transaction('meta').objectStore('meta').get(key));
}

// ---------------------------------------------------------------- archives

export async function packProject(p: Project, blobs: Map<string, Blob>): Promise<Blob> {
  const files: Record<string, Uint8Array> = { 'project.json': strToU8(JSON.stringify(p)) };
  for (const [k, b] of blobs) files[`blobs/${k}`] = new Uint8Array(await b.arrayBuffer());
  return new Blob([zipSync(files, { level: 6 })], { type: 'application/zip' });
}

export async function unpackProject(file: Blob): Promise<{ project: Project; blobs: Map<string, Blob> }> {
  const buf = new Uint8Array(await file.arrayBuffer());
  let project: Project;
  const blobs = new Map<string, Blob>();
  if (buf[0] === 0x7b) project = migrate(JSON.parse(strFromU8(buf))); // bare project.json
  else {
    const z = unzipSync(buf);
    if (!z['project.json']) throw new Error('This archive does not contain a WANDER project (project.json missing).');
    project = migrate(JSON.parse(strFromU8(z['project.json'])));
    for (const [name, data] of Object.entries(z)) {
      if (!name.startsWith('blobs/') || name.endsWith('/')) continue;
      const key = name.slice(6);
      blobs.set(key, new Blob([data], { type: project.scene.assets[key]?.mime ?? 'application/octet-stream' }));
    }
  }
  return { project, blobs };
}

export function download(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 30000);
}
