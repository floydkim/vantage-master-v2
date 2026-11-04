// VMOnline(VMO_WIN)에 들어 있는 DAT/DIR 파일.
import { parseLbDat } from './lbArchive.ts';
import { lbDecompress } from './lbDecompress.ts';

/** DATA??.DAT 번호. 05·06은 없다. */
export const DAT_NUMBERS = [0, 1, 2, 3, 4, 7, 8, 9, 10, 11, 12, 13] as const;
/** 이름 인덱스(DATA??.DIR)가 있는 DAT. */
export const DIR_NUMBERS: readonly number[] = [0, 9, 10];
/** 압축하지 않고 저장된 DAT. DATA13에는 효과음 WAV가 그대로 들어 있다. */
const RAW_DAT_NUMBERS: readonly number[] = [13];

const pad2 = (n: number) => String(n).padStart(2, '0');
export const datFileName = (n: number): string => `DATA${pad2(n)}.DAT`;
export const dirFileName = (n: number): string => `DATA${pad2(n)}.DIR`;

export interface VmDat {
  readonly entryCount: number;
  /** 압축을 푼 항목 내용. */
  read(index: number): Uint8Array;
}

export function openVmDat(datNumber: number, bytes: Uint8Array): VmDat {
  const dat = parseLbDat(bytes);
  const raw = RAW_DAT_NUMBERS.includes(datNumber);
  return {
    entryCount: dat.entryCount,
    read: (index) => (raw ? dat.entry(index) : lbDecompress(dat.entry(index))),
  };
}
