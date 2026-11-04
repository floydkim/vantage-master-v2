import { expect, it } from 'vitest';
import { openExeImage } from '../../src/formats/exeImage.ts';
import { readIcons, smallIcon } from '../../src/formats/icons.ts';
import { readMenu } from '../../src/formats/menus.ts';
import { readOriginal } from '../original.ts';

const exe = openExeImage(readOriginal('vmv2.exe'));

it('프레임 메뉴 0x66: System·Window 펼침 메뉴와 항목 id·글자(0x44e437이 처리)', () => {
  const menu = readMenu(exe, 0x66);
  expect(menu.map((m) => [m.text, m.items?.map((i) => [i.id, i.text])])).toEqual([
    ['System', [[0x9c7b, 'Save GameData'], [0x9c81, 'Turn to Title'], [0x9c80, 'Turn of World Map'], [0x9c82, 'Give up'], [0x9c7e, 'Customize'], [0x9c7c, 'Sound'], [0x9c8d, 'Address Information']]],
    ['Window', [[0x9c43, 'x /2'], [0x9c44, 'x 1'], [0x9c45, 'x 2'], [0x9c5b, 'View'], [0x9c5c, 'Status'], [0x9c7d, 'HelpGuide'], [0x9c83, 'Chat'], [0x9c7f, 'Window arrange']]],
  ]);
});

it('아이콘 0x7e는 32 × 32 둘이고, 캡션용 16 × 16은 색이 많은 쪽을 줄인다(투명 칸 있음)', () => {
  const icons = readIcons(exe, 0x7e);
  expect(icons.map((i) => [i.width, i.height])).toEqual([[32, 32], [32, 32]]);
  const small = smallIcon(icons);
  expect([small.width, small.height, small.bits]).toEqual([16, 16, Math.max(...icons.map((i) => i.bits))]);
  const alpha = [...small.rgba].filter((_, k) => k % 4 === 3);
  expect(alpha.some((a) => a === 0) && alpha.some((a) => a === 255)).toBe(true);
});
