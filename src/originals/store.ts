// 설치 마법사가 넣은 원본(논리 경로 → Blob)을 이 브라우저에 둔다. 바꾸기는 묶음(접두사) 단위로 한 트랜잭션

export interface FileStore {
  get(path: string): Promise<Blob | undefined>;
  paths(): Promise<string[]>;
  /** prefixes로 시작하는 것을 지우고 files를 넣는다(한 번에: 실패하면 아무것도 바뀌지 않는다) */
  replace(prefixes: readonly string[], files: ReadonlyMap<string, Blob>): Promise<void>;
}

const DB = 'vmv2-originals';
const FILES = 'files';
const done = <T>(r: IDBRequest<T>) => new Promise<T>((ok, fail) => ((r.onsuccess = () => ok(r.result)), (r.onerror = () => fail(r.error))));

/** IndexedDB 'vmv2-originals'의 'files'(키 = 논리 경로) */
export function idbStore(): FileStore {
  let db: Promise<IDBDatabase> | null = null;
  const open = () => {
    db ??= new Promise((ok, fail) => {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(FILES);
      r.onsuccess = () => ok(r.result);
      r.onerror = () => fail(r.error);
    });
    return db;
  };
  const files = async (mode: IDBTransactionMode) => (await open()).transaction(FILES, mode).objectStore(FILES);
  return {
    get: async (path) => (await done((await files('readonly')).get(path))) as Blob | undefined,
    paths: async () => (await done((await files('readonly')).getAllKeys())) as string[],
    replace: async (prefixes, put) => {
      const store = await files('readwrite');
      const tx = store.transaction;
      const finished = new Promise<void>((ok, fail) => ((tx.oncomplete = () => ok()), (tx.onabort = () => fail(tx.error)), (tx.onerror = (e) => fail((e.target as IDBRequest).error ?? tx.error)))); // 요청 오류가 올라올 때 tx.error는 아직 null
      for (const key of (await done(store.getAllKeys())) as string[]) if (prefixes.some((p) => key.startsWith(p))) store.delete(key);
      for (const [key, blob] of put) store.put(blob, key);
      await finished;
    },
  };
}

/** 시험용 */
export function memoryStore(): FileStore {
  const map = new Map<string, Blob>();
  return {
    get: async (path) => map.get(path),
    paths: async () => [...map.keys()],
    replace: async (prefixes, put) => {
      for (const key of [...map.keys()]) if (prefixes.some((p) => key.startsWith(p))) map.delete(key);
      for (const [key, blob] of put) map.set(key, blob);
    },
  };
}
