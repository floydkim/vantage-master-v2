import { createRoot } from 'react-dom/client';
import { AssetViewer } from './ui/assetViewer/AssetViewer.tsx';
import { BattleView } from './ui/battle/BattleView.tsx';
import { Play } from './ui/battle/Play.tsx';
import { ReviewPage } from './ui/review/ReviewPage.tsx';

const pages = { '#battle': BattleView, '#play': Play, '#review': ReviewPage } as const;
// 배포판은 주소와 상관없이 게임(설치 마법사 포함). 자료 보기·#battle·#review(번역 검수)는 개발 도구
const Page = import.meta.env.DEV ? (pages[location.hash as keyof typeof pages] ?? AssetViewer) : Play;
createRoot(document.getElementById('root')!).render(<Page />);
