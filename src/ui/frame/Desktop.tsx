import { createContext, type ReactNode, useLayoutEffect, useState } from 'react';
import { fixesOn, type Language, language, setFixesOn, setLanguage } from '../battle/original.ts';
import type { Point, Size } from './layout.ts';
import './win98.css';

/** 고를 수 있는 가상 화면(원작 시절 바탕 화면 해상도) */
export const SCREEN_SIZES: readonly Size[] = [
  { width: 640, height: 480 },
  { width: 800, height: 600 },
  { width: 1024, height: 768 },
  { width: 1152, height: 864 },
  { width: 1280, height: 1024 },
];
const KEY = 'vmv2.screen';
const RESTART_CONFIRM = '게임이 종료됩니다. 바꾸시겠습니까?';
const PAD = 8; // .w98-host 여백(오른쪽·아래)

/** 가상 화면 요소: 팝업(VANTAGEPOPUP)·대화 상자는 여기에 그린다(MDI 클라이언트에 잘리지 않게, 좌표는 화면 기준) */
/** 'fit'은 브라우저 뷰포트에 맞춤(처음 기본), 수는 SCREEN_SIZES 칸 */
type Choice = number | 'fit';

export const ScreenLayer = createContext<{ readonly element: HTMLDivElement | null; readonly size: Size }>({ element: null, size: { width: 0, height: 0 } });
const DEFAULT: Choice = 'fit';

function stored(): Choice {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Size | 'fit' | null;
    if (v === 'fit') return 'fit';
    const i = SCREEN_SIZES.findIndex((s) => v && s.width === v.width && s.height === v.height);
    return i >= 0 ? i : DEFAULT;
  } catch {
    return DEFAULT;
  }
}

/** 브라우저에 맞춘 가상 화면: 뷰포트(스크롤 막대 뺀 크기)에서 화면 자리(문서 왼쪽 위)와 오른쪽·아래 여백을 뺀다. 원작 최소 해상도 640 × 480보다 작아지지 않는다 */
export function fitScreen(viewport: Size, at: Point, pad: number): Size {
  const min = SCREEN_SIZES[0];
  return { width: Math.max(min.width, Math.floor(viewport.width - at.x - pad)), height: Math.max(min.height, Math.floor(viewport.height - at.y - pad)) };
}

/** 가상 화면: 크기는 사용자가 고르고(브라우저 저장소에 둠), 원작 프레임이 그 안에 열린다 */
/**
 * noKorean: 한국어로 두었는데 한국어판 자료가 없거나 다른 빌드라 우리 번역으로 읽었다(언어 select에 '영문판 + 한국어 번역'). onOriginals: 있으면 [원본 파일…](설치 마법사 다시 열기).
 * fixes: 한국어판으로 읽었다(언어 select에 '한국어판', '오역 보정' 체크를 보임). running: 게임을 실행했다(언어·보정을 바꾸면 다시 열려 게임이 끝나므로 묻는다)
 */
export function Desktop({
  noKorean = false,
  fixes = false,
  running = false,
  onOriginals,
  children,
}: { readonly noKorean?: boolean; readonly fixes?: boolean; readonly running?: boolean; readonly onOriginals?: () => void; readonly children: (screen: Size) => ReactNode }) {
  const proceed = () => !running || window.confirm(RESTART_CONFIRM);
  const [choice, setChoice] = useState<Choice>(stored);
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  const [fitted, setFitted] = useState<Size | null>(null);
  // 맞춤이면 그리기 전에 재고(첫 크기로 자식을 한 번 만들었다 바꾸지 않게), 창 크기가 바뀔 때마다 다시
  useLayoutEffect(() => {
    if (choice !== 'fit' || !element) return;
    const measure = () => {
      const r = element.getBoundingClientRect();
      const d = document.documentElement;
      const next = fitScreen({ width: d.clientWidth, height: d.clientHeight }, { x: r.left + window.scrollX, y: r.top + window.scrollY }, PAD);
      setFitted((v) => (v && v.width === next.width && v.height === next.height ? v : next));
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [choice, element]);
  const screen = choice === 'fit' ? fitted : SCREEN_SIZES[choice];
  const choose = (value: string) => {
    const c: Choice = value === 'fit' ? 'fit' : Number(value);
    setChoice(c);
    try {
      localStorage.setItem(KEY, JSON.stringify(c === 'fit' ? 'fit' : SCREEN_SIZES[c]));
    } catch {
      // 저장소를 못 쓰면 이번에만
    }
  };
  return (
    <div className="w98-host">
      <div className="w98-screen-bar">
        <label>
          화면 크기{' '}
          <select value={String(choice)} onChange={(e) => choose(e.target.value)}>
            <option value="fit">브라우저에 맞추기{choice === 'fit' && fitted ? ` (${fitted.width} × ${fitted.height})` : ''}</option>
            {SCREEN_SIZES.map((s, i) => (
              <option key={i} value={i}>
                {s.width} × {s.height}
              </option>
            ))}
          </select>
        </label>{' '}
        <label>
          언어{' '}
          <select
            defaultValue={language()}
            onChange={(e) => {
              if (proceed()) setLanguage(e.target.value as Language);
              else e.target.value = language();
            }}
          >
            <option value="ko">{noKorean ? '영문판 + 한국어 번역' : fixes ? '한국어판' : '한국어'}</option>
            <option value="original">영문판</option>
          </select>
        </label>
        {fixes && (
          <>
            {' '}
            <label>
              <input type="checkbox" checked={fixesOn()} onChange={(e) => proceed() && setFixesOn(e.target.checked)} /> 오역 보정
            </label>
          </>
        )}
        {onOriginals && (
          <>
            {' '}
            <button type="button" onClick={onOriginals}>
              원본 파일…
            </button>
          </>
        )}
      </div>
      <div className="w98-screen" ref={setElement} style={screen ? { width: screen.width, height: screen.height } : { width: 0, height: 0 }}>
        {screen && <ScreenLayer.Provider value={{ element, size: screen }}>{children(screen)}</ScreenLayer.Provider>}
      </div>
    </div>
  );
}
