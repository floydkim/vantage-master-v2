// BGM(vmv2.exe 0x443770·0x443847·0x44372e): 곡 표 19곡, 장치(0 CD, 1 MIDI), 옵션 비트 0x10(BGM 켬). 해독 메모 notes_options.md §3.5
import type { ExeImage } from '../../formats/exeImage.ts';
import type { GameMap } from '../../formats/mapData.ts';

const TABLE = 0x4742f0; // 0x14바이트 × 19: CD 트랙, GM·GS·S8 파일 이름 포인터, 반복
const TRACKS = 19;
const BGM_ON = 0x10;

export interface BgmTrack {
  readonly cd: number;
  /** MIDI 폴더의 파일 이름(GM, GS, SC-88) */
  readonly files: readonly [string, string, string];
  /** 끝나면 처음부터 다시(0x443847) */
  readonly loop: boolean;
}

export function readBgmTable(exe: ExeImage): BgmTrack[] {
  const v = new DataView(exe.read(TABLE, TRACKS * 0x14).buffer);
  return Array.from({ length: TRACKS }, (_, i) => {
    const at = i * 0x14;
    const name = (k: number) => exe.cString(v.getUint32(at + 4 + k * 4, true));
    return { cd: v.getUint32(at, true), files: [name(0), name(1), name(2)], loop: v.getUint32(at + 0x10, true) !== 0 };
  });
}

/** 재생 장치(원작 MCI). play는 곡을 열고 처음부터, replay는 연 곡을 처음부터 다시(MIDI 0x443beb, CD는 play와 같음), stop은 멈춤·닫기 */
export interface BgmDevice {
  play(track: number): boolean;
  replay(): boolean;
  stop(): void;
  /** CD만: 장치 열기(0x4438ed)·닫기(0x443a95) */
  open?(): void;
  close?(): void;
}

/** 장치 0 CD(0x443973), 1·2 MIDI 시퀀서(0x443b26), 3 SC-88: 원작은 S8 MIDI 파일을 시퀀서로, 리메이크는 SC-88 녹음을 */
type Devices = { readonly cd: BgmDevice; readonly midi: BgmDevice; readonly sc88: BgmDevice };

export class Bgm {
  /** 0x4cd698 지금 곡(−1 없음). BGM이 꺼져 있어도 적어 둔다 */
  current = -1;
  /** 0x4cd690 틀고 있음 */
  playing = false;

  readonly table: readonly BgmTrack[];
  private readonly devices: Devices;
  /** 옵션 word(0x503ff0) */
  options: number;
  /** 0x4cd688: 0 CD, 1 MIDI(GM), 2 MIDI(GS, 파일이 없어 고를 수 없음), 3 SC-88 */
  device: number;

  constructor(table: readonly BgmTrack[], devices: Devices, options: number, device: number) {
    this.table = table;
    this.devices = devices;
    this.options = options;
    this.device = device;
  }

  private get out(): BgmDevice {
    return this.device === 0 ? this.devices.cd : this.device === 3 ? this.devices.sc88 : this.devices.midi;
  }

  // vmv2.exe 0x0044380e
  private halt(): void {
    if (!this.playing) return;
    this.out.stop();
    this.playing = false;
  }

  // vmv2.exe 0x004437fa
  private drop(): void {
    this.current = -1;
    this.halt();
  }

  /** vmv2.exe 0x00443770: 같은 곡을 틀고 있으면 아무것도 안 함. BGM이 꺼져 있으면 곡 번호만 */
  play(track: number): void {
    if (!(this.options & BGM_ON)) {
      this.current = track;
      this.halt();
      this.devices.cd.close?.();
      return;
    }
    if (track === this.current && this.playing) return;
    this.drop();
    this.current = track;
    if (track !== -1 && this.out.play(track)) this.playing = true;
  }

  /** vmv2.exe 0x00443847: 지금 장치에서 온 성공한 끝 알림이면 반복 곡은 다시, 아니면 멈추고 −1 */
  ended(fromCurrentDevice = true): void {
    if (!fromCurrentDevice || this.current === -1 || !this.playing) return;
    if (!this.table[this.current].loop) return this.drop();
    if (!(this.device === 0 ? this.out.play(this.current) : this.out.replay())) this.playing = false;
  }

  /** vmv2.exe 0x0044372e(Sound 대화 상자 OK 뒤): 꺼졌으면 멈춤, 켜졌으면 지금 곡을(CD면 장치를 연 뒤) */
  apply(): void {
    if (!(this.options & BGM_ON)) {
      this.halt();
      this.devices.cd.close?.();
      return;
    }
    if (this.device === 0) this.devices.cd.open?.();
    this.play(this.current);
  }

  /** Sound 대화 상자가 쓰는 옵션 비트·장치 */
  configure(options: number, device: number): void {
    this.options = options;
    this.device = device;
  }

  /** vmv2.exe 0x00443511 OK 뒤: 장치가 바뀌면 지금 곡 멈춤·CD 닫기, 그다음 쓰고 BGM 비트나 장치가 바뀌었으면 apply */
  soundOk(options: number, device: number, r: { readonly stop: boolean; readonly restart: boolean }): void {
    if (r.stop) {
      this.halt();
      this.devices.cd.close?.();
    }
    this.configure(options, device);
    if (r.restart) this.apply();
  }

  /** vmv2.exe 0x0044371a(프로그램 끝): 멈추고 −1, CD 닫기 */
  close(): void {
    this.drop();
    this.devices.cd.close?.();
  }

  /** 비동기 장치가 나중에 열기에 실패했다(파일·사운드폰트 없음): MCI 열기 실패처럼 틀고 있지 않음 */
  failed(track: number): void {
    if (track === this.current) this.playing = false;
  }
}

/** 전투 곡(0x401a0c): 맵 구조체 +0x2c */
export const battleTrack = (map: GameMap): number => new DataView(map.struct.buffer, map.struct.byteOffset, map.struct.byteLength).getInt32(0x2c, true);
