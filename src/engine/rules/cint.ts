// 원작(MSVC, x87)의 정수 산술을 JS에서 똑같이 하는 도우미.

/** C의 int 나눗셈: 0 쪽으로 버리고 −0을 만들지 않는다 */
export const cdiv = (a: number, b: number): number => (a / b) | 0;

/** vmv2.exe __ftol(0x452538): 버림 모드로 fistp qword 한 뒤 하위 dword. NaN·무한대는 정수 부정값(하위 dword 0)이라 0 */
export const ftol = (x: number): number => Math.trunc(x) | 0;
