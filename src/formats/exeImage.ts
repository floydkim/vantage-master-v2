// vmv2.exe(PE32)의 가상 주소(VA)로 바이트를 읽는다. 고정 표는 다른 원본 데이터처럼 실행할 때 exe에서 읽는다.

export interface ExeImage {
  /** VA부터 size바이트. 파일에 없는 뒷부분(초기화되지 않은 데이터)은 0이다. 섹션 경계를 넘으면 RangeError. */
  read(va: number, size: number): Uint8Array;
  /** VA의 NUL 종료 ASCII 문자열 */
  cString(va: number): string;
  /** 이미지 기준 주소(RVA + imageBase = VA) */
  readonly imageBase: number;
  /** 리소스 디렉터리(데이터 디렉터리 2)의 VA, 없으면 0 */
  readonly resources: number;
}

interface Section {
  readonly va: number;
  readonly virtualSize: number;
  readonly rawSize: number;
  readonly rawOffset: number;
}

export function openExeImage(exe: Uint8Array): ExeImage {
  if (exe.length < 0x40) throw new Error(`실행 파일이 너무 작습니다: ${exe.length}바이트`);
  const view = new DataView(exe.buffer, exe.byteOffset, exe.byteLength);
  const pe = view.getUint32(0x3c, true);
  if (view.getUint16(0, true) !== 0x5a4d || pe + 24 > exe.length || view.getUint32(pe, true) !== 0x00004550) throw new Error('PE 실행 파일이 아닙니다');
  const count = view.getUint16(pe + 6, true);
  const optional = pe + 24;
  const imageBase = view.getUint32(optional + 28, true);
  const resourceRva = view.getUint32(optional + 96 + 2 * 8, true);
  const table = optional + view.getUint16(pe + 20, true);
  if (table + count * 40 > exe.length) throw new Error('실행 파일이 잘렸습니다(섹션 표)');
  const sections: Section[] = [];
  for (let i = 0; i < count; i++) {
    const at = table + i * 40;
    if (view.getUint32(at + 20, true) + view.getUint32(at + 16, true) > exe.length) throw new Error(`실행 파일이 잘렸습니다(섹션 ${i})`);
    sections.push({
      va: imageBase + view.getUint32(at + 12, true),
      virtualSize: view.getUint32(at + 8, true),
      rawSize: view.getUint32(at + 16, true),
      rawOffset: view.getUint32(at + 20, true),
    });
  }
  const find = (va: number, size: number): Section => {
    const s = sections.find((x) => va >= x.va && va + size <= x.va + Math.max(x.virtualSize, x.rawSize));
    if (!s) throw new RangeError(`exe에 없는 주소 범위: 0x${va.toString(16)} (+${size})`);
    return s;
  };
  const read = (va: number, size: number): Uint8Array => {
    const s = find(va, size);
    const out = new Uint8Array(size);
    const from = va - s.va;
    const available = Math.max(0, Math.min(size, s.rawSize - from));
    out.set(exe.subarray(s.rawOffset + from, s.rawOffset + from + available));
    return out;
  };
  return {
    read,
    imageBase,
    resources: resourceRva ? imageBase + resourceRva : 0,
    cString(va) {
      const s = find(va, 1);
      const bytes = exe.subarray(s.rawOffset + va - s.va, s.rawOffset + s.rawSize);
      const end = bytes.indexOf(0);
      if (end < 0) throw new RangeError(`문자열이 끝나지 않습니다: 0x${va.toString(16)}`);
      return new TextDecoder('ascii').decode(bytes.subarray(0, end));
    },
  };
}

// 한국어판 exe를 붙일 자리: 두 판의 주소가 겹치므로 한국어판은 이만큼 올려 붙인다(리소스 DLL을 다른 기준 주소에 올리듯)
const KO_SHIFT = 0x40000000;

/**
 * 영문판 exe에 한국어판을 겹친 exe. 표(수치)는 영문판, cString은 대응표(영문 VA → 한국어 VA)에 있으면 한국어판 바이트를
 * 그대로(글자 하나 = 바이트 하나, CP949) 돌려주고, 리소스(대화 상자·메뉴·아이콘)는 한국어판이다.
 */
export function koreanExe(en: ExeImage, ko: ExeImage, pairs: ReadonlyMap<number, number>): ExeImage {
  const texts = new Map<number, string>();
  const koString = (va: number): string => {
    let s = '';
    for (let c = ko.read(va, 1)[0]; c !== 0; c = ko.read(++va, 1)[0]) s += String.fromCharCode(c);
    return s;
  };
  return {
    read: (va, size) => (va >= KO_SHIFT ? ko.read(va - KO_SHIFT, size) : en.read(va, size)),
    imageBase: KO_SHIFT + ko.imageBase,
    resources: KO_SHIFT + ko.resources,
    cString(va) {
      const k = pairs.get(va);
      if (k === undefined) return en.cString(va);
      let s = texts.get(k);
      if (s === undefined) texts.set(k, (s = koString(k)));
      return s;
    },
  };
}
