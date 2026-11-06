import { chromium } from 'playwright';
import { mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.env.BASE_URL || 'http://127.0.0.1:8771';
mkdirSync(path.join(HERE, 'out'), { recursive: true });
import fs from 'fs';
// 이 테스트는 가짜 서버를 끼우므로 서비스 워커(앱 저장)는 끈다 — pwa.mjs에서 따로 검사
const fake = fs.readFileSync(path.join(HERE, 'fake2.js'), 'utf8');
const b = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH, args: ['--no-sandbox'] } : { args: ['--no-sandbox'] });
const out = []; const ok = (n, c, x = '') => out.push(`${c ? 'PASS' : 'FAIL'}  ${n}${x ? '  → ' + String(x).replace(/\s+/g, ' ').slice(0, 160) : ''}`);
let W = { rain: 0, tmax: 7, tmin: -1 };
async function pickPage(p, t) { await p.locator('.modal .choice', { hasText: t }).first().click(); await p.waitForTimeout(180); }
async function picks(p, list) { for (const t of list) await pickPage(p, t); }
async function factPage(p, levels) { for (let i = 0; i < levels.length; i++) { const btn = p.locator(`.modal [data-fact="${i}"][data-lv="${levels[i]}"]`); if (await btn.count()) await btn.click(); } await p.click('#q-next'); await p.waitForTimeout(150); }
async function facts(p, matrix) { for (const row of matrix) await factPage(p, row); }
async function page(w, h = 800, ctx) {
  const c = ctx || await b.newContext({ serviceWorkers: 'block', viewport: { width: w, height: h } });
  const p = await c.newPage();
  p.errs = []; p.on('pageerror', e => p.errs.push(e.message)); p.on('dialog', d => d.accept());
  await p.route('**/*', r => { const u = r.request().url();
    // 테스트는 가짜 서버(fake*.js)를 끼우므로 SRI 무결성 검사만 테스트 페이지에서 뺀다(실제 사이트는 그대로)
    if (u.endsWith('/index.html')) return r.fetch().then(async resp => r.fulfill({ response: resp, body: (await resp.text()).replace(/ integrity="[^"]+"/g, '') }));
    if (u.includes('supabase-js')) return r.fulfill({ contentType: 'application/javascript', body: fake });
    if (u.includes('/api/info')) {
      const q = new URL(u).searchParams, t = q.get('type');
      if (t === 'locate') return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, label: '서울 성동구 성수동1가' }) });
      if (t === 'weather') return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, place: '서울 성동구 성수동1가', date: q.get('date'), ...W, uv: 3, sunset: '17:27', pm10: 13, pm25: 13, source: 'Open-Meteo(테스트)', fetchedAt: new Date().toISOString() }) });
      if (t === 'holiday') return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, date: q.get('date'), holiday: null, offDays: 2, longWeekend: false, source: 'Nager.Date(테스트)', fetchedAt: new Date().toISOString() }) });
      return r.fulfill({ contentType: 'application/json', body: '{"ok":false,"reason":"테스트"}' });
    }
    if (u.startsWith(BASE)) return r.continue(); return r.abort(); });
  await p.goto(BASE + '/index.html'); await p.waitForTimeout(300); p.ctx = c; return p;
}
const modal = p => p.locator('.modal').innerText().catch(() => '');
const scrollTop = p => p.evaluate(() => document.querySelector('.modal').scrollTop);
const kst = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const addDays = (d, n) => new Date(Date.parse(d) + n * 86400e3).toISOString().slice(0, 10);
const nextSat = () => { const t = kst(), dow = new Date(t + 'T00:00:00Z').getUTCDay(); return addDays(t, (6 - dow + 7) % 7); };

// ---------- 좁은 화면(390) ----------
let p = await page(390);
// 12 홈 빈 기록 문구
ok('12 홈 빈 기록 문구: "옆의" 없음', !(await p.locator('#recent-list').innerText()).includes('옆의'), await p.locator('#recent-list').innerText());
// 3 메뉴 잘림
for (const w of [390, 621]) {
  await p.setViewportSize({ width: w, height: 800 }); await p.waitForTimeout(200);
  const r = await p.evaluate(() => { const l = document.querySelector('.login-btn').getBoundingClientRect(); const n = document.querySelector('nav'); return { right: l.right, w: innerWidth, sw: n.scrollWidth, cw: n.clientWidth, docw: document.documentElement.scrollWidth, navh: n.getBoundingClientRect().height }; });
  ok(`3 ${w}px: 로그인 버튼 전부 보임·메뉴 가로 스크롤 없음`, r.right <= r.w && r.sw <= r.cw + 1 && r.docw <= r.w, JSON.stringify(r));
}
await p.setViewportSize({ width: 390, height: 800 });

// 5·6 제목에서 자동 채우기 + 예시
await p.click('[data-action="meeting"] >> visible=true'); await p.waitForTimeout(200);
await p.locator('.modal [data-cat="나들이"]').click(); await p.waitForTimeout(150);
await p.fill('#meeting-title', '이번 토요일에 성수동 놀러 갈까?'); await p.waitForTimeout(100);
ok('5 제목 → 지역 자동 채움', await p.inputValue('#meeting-place') === '성수동', await p.inputValue('#meeting-place'));
ok('5 제목 → 날짜(이번 토요일) 자동 채움', await p.inputValue('#meeting-date') === nextSat(), await p.inputValue('#meeting-date') + ' vs ' + nextSat());
ok('5 자동 채움 안내 표시', (await p.locator('#auto-hint').innerText()).includes('제목에서 찾아 채웠어요'), await p.locator('#auto-hint').innerText());
await p.fill('#meeting-place', '서울 성수동'); await p.fill('#meeting-title', '이번 일요일에 강남역 갈까?'); await p.waitForTimeout(100);
ok('5 직접 고친 지역은 덮어쓰지 않음', await p.inputValue('#meeting-place') === '서울 성수동');
ok('6 나들이 선택지 예시', (await p.locator('.opt-input').first().getAttribute('placeholder')).includes('한강'));
// 1 쇼핑 안내문
await p.locator('.modal [data-cat="쇼핑"]').click(); await p.waitForTimeout(150);
ok('1 쇼핑 선택 시 일상 안내문 없음', !(await modal(p)).includes('일상 고민은 외부 정보'));
await p.locator('.modal [data-cat="일상"]').click(); await p.waitForTimeout(150);
ok('1 일상 선택 시 일상 안내문 있음', (await modal(p)).includes('일상 고민은 외부 정보'));
await p.locator('.modal [data-cat="나들이"]').click(); await p.waitForTimeout(150);
await p.fill('#meeting-title', '이번 토요일에 성수동 놀러 갈까?');
await p.locator('.opt-input').nth(0).fill('성수동 나들이'); await p.locator('.opt-input').nth(1).fill('집에서 쉬기');
// 2 스크롤 유지 (태그)
await p.evaluate(() => { const m = document.querySelector('.modal'); m.scrollTop = 300; });
const y0 = await scrollTop(p);
await p.locator('[data-tag="0"][data-v="out"]').click(); await p.waitForTimeout(100);
const y1 = await scrollTop(p);
await p.locator('[data-tag="1"][data-v="in"]').click(); await p.waitForTimeout(100);
ok('2 실내/야외 표시해도 화면이 맨 위로 튀지 않음', y0 > 100 && Math.abs(y1 - y0) < 5 && Math.abs((await scrollTop(p)) - y0) < 5, `${y0} → ${y1} → ${await scrollTop(p)}`);
ok('2 누른 버튼에 포커스 유지', await p.evaluate(() => document.activeElement && document.activeElement.matches('[data-tag="1"][data-v="in"]')));
// 4 새로고침해도 이어서 (입력 중)
await p.reload(); await p.waitForTimeout(500);
ok('4 새로고침 후 홈에 "이어서 하기" 줄', (await p.locator('#resume-row').innerText().catch(() => '')).includes('성수동'));
await p.click('#resume-row'); await p.waitForTimeout(200);
await p.click('#resume-go'); await p.waitForTimeout(200);
ok('4 입력 중이던 지역·선택지·태그까지 복원', await p.inputValue('#meeting-place') === '서울 성수동' && await p.locator('.opt-input').nth(1).inputValue() === '집에서 쉬기' && await p.locator('[data-tag="0"][data-v="out"]').getAttribute('aria-pressed') === 'true',
  await p.inputValue('#meeting-place'));
await p.fill('#meeting-place', '성수동');
await p.locator('#agenda-form button[type="submit"]').click(); await p.waitForTimeout(400);
await picks(p, ['집에서 쉬기', '성수동 나들이']); // 위험이 가장 큰 쪽 · 가장 설레는 쪽
await p.reload(); await p.waitForTimeout(500);
await p.click('[data-action="meeting"] >> visible=true'); await p.waitForTimeout(200);
ok('4 질문 단계도 새로고침 후 이어서', (await modal(p)).includes('장관 질문 3/4'), (await modal(p)).slice(0, 120));
await p.click('#resume-go'); await p.waitForTimeout(200);
await picks(p, ['성수동 나들이', '집에서 쉬기']); // 돈·시간이 가장 많이 드는 쪽 · 바로 할 수 있는 쪽
// 2 스크롤 유지 (기준 카드)
await p.setViewportSize({ width: 390, height: 480 }); await p.waitForTimeout(100);
await p.evaluate(() => { document.querySelector('.modal').scrollTop = 200; });
const z0 = await scrollTop(p);
await p.locator('.modal .prio').nth(1).click(); await p.waitForTimeout(100);
ok('2 기준 카드 눌러도 스크롤 유지', z0 > 50 && Math.abs((await scrollTop(p)) - z0) < 5, `${z0} → ${await scrollTop(p)}`);
await p.setViewportSize({ width: 390, height: 800 });
await p.locator('.modal button', { hasText: '표결 시작' }).click(); await p.waitForTimeout(800);
await p.click('#chat-skip'); await p.waitForTimeout(500);
let res = await modal(p);
// 7 추운 날씨
ok('7 최저 -1℃·최고 7℃: "날씨도 좋아요" 안 함', !res.includes('날씨도 좋아요'));
ok('7 쌀쌀한 날씨 주의가 근거와 신중주의 판단 이유에 표시', res.includes('쌀쌀한 날씨') && res.includes('야외인데 쌀쌀한 날씨'), res.slice(0, 200));
ok('12 요약표: 이긴 쪽 칩 강조', await p.locator('.sum-chip.win').count() === 2 && await p.locator('.sum-chip.lose').count() === 2);
ok('4 판결 후 임시 저장 삭제', await p.evaluate(() => localStorage.getItem('decision-country-draft')) === null);
await p.click('#result-done'); await p.waitForTimeout(300);
ok('4 판결 후 홈의 이어서 하기 줄 없어짐', !(await p.locator('#resume-row').count()));
// 10 미래 일정 → 나중에 묻기
await p.click('[data-action="records"] >> visible=true'); await p.waitForTimeout(300);
await p.locator('.record-detail summary').first().click(); await p.waitForTimeout(150);
const later = p.locator('.record-detail').first().locator('.fu-later');
console.log('REC', await p.evaluate(() => JSON.stringify(JSON.parse(localStorage.getItem('decision-country-records'))[0].when)), nextSat(), kst());
const isFuture = nextSat() > kst();
if (isFuture) {
  ok('10 내일 이후 일정: "다녀온 뒤에" 안내, 버튼 숨김', (await later.innerText()).includes('다녀온 뒤에') && !(await p.locator('.record-detail').first().locator('[data-fu]').isVisible()));
  await later.locator('[data-fu-now]').click(); await p.waitForTimeout(100);
  ok('10 "지금 남기기" 누르면 버튼 보임', await p.locator('.record-detail').first().locator('[data-fu]').isVisible());
} else ok('10 (오늘이 토요일이라 미래 일정 검사 생략)', true);
await p.evaluate(() => document.getElementById('modal-root').innerHTML = '');

// 7 추운 날씨(최고 4℃) + 실내 대안 → 신중주의 표 이동
W = { rain: 0, tmax: 4, tmin: -3 };
await p.click('[data-action="meeting"] >> visible=true'); await p.waitForTimeout(200);
if (await p.locator('#resume-new').count()) await p.click('#resume-new');
await p.locator('.modal [data-cat="나들이"]').click(); await p.waitForTimeout(100);
await p.fill('#meeting-title', '내일 한강 갈까?');
await p.locator('.opt-input').nth(0).fill('한강 피크닉'); await p.locator('.opt-input').nth(1).fill('카페');
await p.locator('[data-tag="0"][data-v="out"]').click(); await p.waitForTimeout(80); await p.locator('[data-tag="1"][data-v="in"]').click(); await p.waitForTimeout(80);
ok('5 "내일 한강" → 지역 한강·날짜 내일', await p.inputValue('#meeting-place') === '한강' && await p.inputValue('#meeting-date') === addDays(kst(), 1));
await p.locator('#agenda-form button[type="submit"]').click(); await p.waitForTimeout(400);
await picks(p, ['비슷해요', '한강 피크닉', '카페', '한강 피크닉']); // 위험은 비슷(근거 없으면 신중주의 기권)
await p.locator('.modal .prio').nth(0).click(); await p.locator('.modal button', { hasText: '표결 시작' }).click(); await p.waitForTimeout(800);
await p.click('#chat-skip'); await p.waitForTimeout(400);
res = await modal(p);
ok('7 최고 4℃(추운 날씨) → 신중주의가 확인된 근거로 다시 판단해 실내에 투표', res.includes('추운 날씨') && /신중주의: 기권 → 「카페」/.test(res), res.split('⑤')[1]?.slice(0, 200));
await p.click('#result-done');

// 8·9·12 쇼핑
await p.click('[data-action="meeting"] >> visible=true'); await p.waitForTimeout(200);
await p.locator('.modal [data-cat="쇼핑"]').click(); await p.waitForTimeout(100);
await p.fill('#meeting-title', '새 이어폰 살까?');
await p.locator('#agenda-form button[type="submit"]').click(); await p.waitForTimeout(300);
await p.fill('#price', '129000'); await p.fill('#budget', '100000');
ok('12 금액 읽기 도움말', (await p.locator('#price-echo').innerText()).includes('129,000원') && (await p.locator('#price-echo').innerText()).includes('12.9만'), await p.locator('#price-echo').innerText());
await p.locator('#budget').blur(); await p.locator('#price').focus(); await p.locator('#price').blur(); await p.waitForTimeout(50);
ok('12 칸에서 나가면 쉼표 표시', await p.inputValue('#price') === '129,000' && await p.inputValue('#budget') === '100,000');
await p.evaluate(() => { document.querySelector('.modal').scrollTop = 250; });
const s0 = await scrollTop(p);
await p.locator('[data-shop="owned"][data-val="true"]').click(); await p.waitForTimeout(80);
ok('2 쇼핑 칩 눌러도 스크롤 유지', s0 > 50 && Math.abs((await scrollTop(p)) - s0) < 5, `${s0} → ${await scrollTop(p)}`);
await p.locator('[data-shop="use"][data-val="week"]').click(); await p.locator('[data-shop="need"][data-val="high"]').click();
await p.locator('#shop-form button[type="submit"]').click(); await p.waitForTimeout(300);
await p.locator('.modal .prio').nth(1).click(); await p.locator('.modal button', { hasText: '표결 시작' }).click(); await p.waitForTimeout(800);
if (await p.locator('#chat-skip').count()) await p.click('#chat-skip'); await p.waitForTimeout(400);
res = await modal(p);
const ifs = await p.locator('.sum-if li').allInnerTexts();
ok('8 예산 초과: 결과 바뀌는 조건이 겹치지 않음(한 줄, 직권 보류 설명)', ifs.length === 1 && ifs[0].includes('직권 보류가 풀리고'), ifs.join(' | '));
ok('9 직권 보류 때 "소수 의견" 대신 "표결 다수 의견"', res.includes('표결 다수 의견') && !res.includes('소수 의견'), res.split('표결 다수 의견')[1]?.slice(0, 120));
await p.click('#result-done');

// 11 여론: 손님이 선택지 누르면 로그인 안내
await p.evaluate(() => { const S = window.__S, now = Date.now(); S.polls.push({ id: 'p9', user_id: 'uid-A', title: '아우터 뭐 살까?', category: '쇼핑', options: ['가죽자켓', '뽀글이'], created_at: new Date(now - 60e3).toISOString(), closes_at: new Date(now + 9 * 3600e3).toISOString() }); S.votes.push({ poll_id: 'p9', user_id: 'x', option_index: 0 }); });
await p.click('[data-action="polls"] >> visible=true'); await p.waitForTimeout(400);
ok('11 손님: 진행 중 여론 결과는 투표 전 숨김', !(await p.locator('.poll-card .tally').count()) && (await p.locator('[data-vote]').count()) === 2);
await p.locator('[data-vote]').first().click(); await p.waitForTimeout(300);
ok('11 손님이 선택지 누르면 로그인 안내', (await modal(p)).includes('투표하려면 로그인'), (await modal(p)).slice(0, 100));
ok('오류 없음(390)', !p.errs.length, p.errs.join('|'));

// 3 넓은 화면 회귀: 한 화면 유지
const d = await page(1920, 937);
const fit = await d.evaluate(() => ({ sh: document.documentElement.scrollHeight, h: innerHeight, sw: document.documentElement.scrollWidth, w: innerWidth }));
ok('PC 1920×937: 홈이 한 화면, 가로 넘침 없음', fit.sh <= fit.h + 2 && fit.sw <= fit.w, JSON.stringify(fit));
await d.screenshot({ path: path.join(HERE, 'out', 'fix-1920.png') });
const m = await page(390, 844);
await m.screenshot({ path: path.join(HERE, 'out', 'fix-390.png') });
ok('오류 없음(PC)', !d.errs.length, d.errs.join('|'));
console.log(out.join('\n')); console.log(`\n${out.filter(x => x.startsWith('PASS')).length}/${out.length} 통과`);
await b.close();
