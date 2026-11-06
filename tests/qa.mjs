import { chromium } from 'playwright';
import { mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.env.BASE_URL || 'http://127.0.0.1:8771';
mkdirSync(path.join(HERE, 'out'), { recursive: true });
import fs from 'fs';
const fake = fs.readFileSync(path.join(HERE, 'fake2.js'), 'utf8');
const b = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH, args: ['--no-sandbox'] } : { args: ['--no-sandbox'] });
const out = []; const ok = (n, c, x = '') => out.push(`${c ? 'PASS' : 'FAIL'}  ${n}${x ? '  → ' + String(x).replace(/\s+/g, ' ').slice(0, 140) : ''}`);
async function page(w, h = 860, apiMode = 'ok') {
  const p = await b.newPage({ viewport: { width: w, height: h } });
  p.errs = []; p.dialogs = []; p.on('pageerror', e => p.errs.push(e.message));
  p.on('dialog', async d => { p.dialogs.push(d.message()); p.dialogAnswer === false ? await d.dismiss() : await d.accept(); });
  await p.route('**/*', r => { const u = r.request().url();
    // 테스트는 가짜 서버(fake*.js)를 끼우므로 SRI 무결성 검사만 테스트 페이지에서 뺀다(실제 사이트는 그대로)
    if (u.endsWith('/index.html')) return r.fetch().then(async resp => r.fulfill({ response: resp, body: (await resp.text()).replace(/ integrity="[^"]+"/g, '') }));
    if (u.includes('supabase-js')) return r.fulfill({ contentType: 'application/javascript', body: fake });
    if (u.includes('/api/info')) {
      const q = new URL(u).searchParams, t = q.get('type');
      if (apiMode === 'down') return r.fulfill({ status: 502, contentType: 'application/json', body: '{"ok":false,"reason":"외부 정보 서버 장애"}' });
      if (t === 'locate') return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, label: '강원특별자치도 강릉시' }) });
      if (t === 'weather') return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, place: '강릉', date: q.get('date'), rain: 80, tmax: 12, tmin: 5, uv: 2, code: 61, sunset: '17:20', pm10: 20, pm25: 9, source: 'Open-Meteo(테스트)', fetchedAt: new Date().toISOString() }) });
      if (t === 'holiday') return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, date: q.get('date'), holiday: null, offDays: 0, longWeekend: false, source: 'Nager.Date(테스트)', fetchedAt: new Date().toISOString() }) });
      return r.fulfill({ contentType: 'application/json', body: '{"ok":false,"reason":"테스트"}' });
    }
    if (u.startsWith(BASE)) return r.continue(); return r.abort(); });
  await p.goto(BASE + '/index.html'); await p.waitForTimeout(300); return p;
}
const clear = p => p.evaluate(() => document.getElementById('modal-root').innerHTML = '');
const modal = p => p.locator('.modal').innerText().catch(() => '');
async function intake(p, { title, cat, place, opts = [], tags = [] }) {
  await p.click('[data-action="meeting"] >> visible=true'); await p.waitForTimeout(200);
  if ((await p.locator('#resume-new').count())) { await p.click('#resume-new'); await p.waitForTimeout(150); }
  await p.fill('#meeting-title', title);
  if (cat) { await p.locator(`.modal [data-cat="${cat}"]`).click(); await p.waitForTimeout(150); }
  if (place) await p.fill('#meeting-place', place);
  for (let i = 0; i < opts.length; i++) { if (i >= 2) await p.locator('#add-opt').click(); await p.locator('.opt-input').nth(i).fill(opts[i]); }
  for (let i = 0; i < tags.length; i++) if (tags[i]) { await p.locator(`[data-tag="${i}"][data-v="${tags[i]}"]`).click(); await p.waitForTimeout(100); }
  await p.locator('#agenda-form button[type="submit"]').click(); await p.waitForTimeout(500);
}
async function answer(p, answers, prio = 0, tiebreak) {
  for (const a of answers) { await p.locator('.modal .choice', { hasText: a }).first().click(); await p.waitForTimeout(200); }
  await p.locator('.modal .prio').nth(prio).click(); await p.waitForTimeout(120);
  await p.locator('.modal button', { hasText: '표결 시작' }).click(); await p.waitForTimeout(700);
  if (tiebreak !== undefined && await p.locator('[data-tb]').count()) { await p.locator('[data-tb]').nth(tiebreak).click(); await p.waitForTimeout(400); }
  if (await p.locator('#chat-skip').count()) { await p.click('#chat-skip'); await p.waitForTimeout(500); }
}
let p = await page(1280);

// [QA1] 공란·중복
await p.click('[data-action="meeting"] >> visible=true'); await p.waitForTimeout(200);
ok('1-1 접수 화면 4단계 안내', (await p.locator('.guide-line').innerText()).includes('장관 질문 4개'));
await p.locator('#agenda-form button[type="submit"]').click(); await p.waitForTimeout(150);
ok('QA1 공란 → 안내', (await p.locator('#agenda-err').innerText()).includes('제목'));
await p.fill('#meeting-title', '테스트'); await p.locator('.opt-input').nth(0).fill('짜장'); await p.locator('.opt-input').nth(1).fill(' 짜 장');
await p.locator('#agenda-form button[type="submit"]').click(); await p.waitForTimeout(150);
ok('QA1 중복 선택지 → 안내', (await p.locator('#agenda-err').innerText()).includes('두 번'));
// 1-1 이어서 하기
await p.locator('.opt-input').nth(1).fill('짬뽕'); await p.locator('#agenda-form button[type="submit"]').click(); await p.waitForTimeout(300);
await p.locator('.modal .choice', { hasText: '짜장' }).first().click(); await p.waitForTimeout(200);
await clear(p); await p.click('[data-action="meeting"] >> visible=true'); await p.waitForTimeout(200);
ok('1-1 닫았다 다시 열면 이어서 하기 제안', (await modal(p)).includes('진행 중이던 회의') && (await modal(p)).includes('장관 질문 2/4'));
await p.click('#resume-go'); await p.waitForTimeout(200);
ok('1-1 이어서 하기 → 질문 2/4로 복귀', (await modal(p)).includes('질문 2 / 4'));
await clear(p);
// 1-1 예시가 입력을 몰래 덮어쓰지 않음
await p.fill('#quick-title', '내가 적은 고민'); p.dialogAnswer = false;
await p.locator('[data-example="0"]').click(); await p.waitForTimeout(200);
ok('1-1 예시 클릭 시 확인 묻고, 취소하면 입력 유지', p.dialogs.some(d => d.includes('내가 적은 고민')) && (await p.inputValue('#quick-title')) === '내가 적은 고민');
p.dialogAnswer = true; await p.fill('#quick-title', '');
await clear(p);

// [QA2] 동점 → 결선, 전원 기권 → 보류
await intake(p, { title: '동점 테스트', opts: ['A안', 'B안'] });
await answer(p, ['A안', 'B안', 'A안', 'B안'], 0, 1).catch(() => {});
// prio 0 (신중주의=A안) -> 2.5 vs 2 not tie; use different: tie requires 1.5 weighting; do explicit tie: abstain one
await clear(p);
await intake(p, { title: '동점 테스트2', opts: ['A안', 'B안'] });
for (const a of ['A안', 'B안', '비슷해요', '비슷해요']) { await p.locator('.modal .choice', { hasText: a }).first().click(); await p.waitForTimeout(200); }
await p.locator('.modal .prio').nth(2).click(); await p.waitForTimeout(100);
await p.locator('.modal button', { hasText: '표결 시작' }).click(); await p.waitForTimeout(600);
const tieScreen = await modal(p);
ok('QA2 동점 → 국무총리 결선 질문', /결선|동점|갈렸/.test(tieScreen), tieScreen.slice(0, 80));
if (await p.locator('[data-tb]').count()) { await p.locator('[data-tb]').nth(1).click(); await p.waitForTimeout(400); await p.click('#chat-skip'); await p.waitForTimeout(400); }
ok('QA2 결선 후 판결에 결선 사유 표시', (await modal(p)).includes('결선'));
await clear(p);
await intake(p, { title: '기권 테스트', opts: ['A안', 'B안'] });
await answer(p, ['비슷해요', '비슷해요', '비슷해요', '비슷해요'], 1);
const ab = await modal(p);
ok('QA2 전원 기권 → 판단 보류 + 사유', ab.includes('판단 보류') && ab.includes('기권'));
await clear(p);

// [QA3] 쇼핑 예산 초과 → 직권 보류
await intake(p, { title: '노트북 살까?', cat: '쇼핑' });
await p.fill('#price', '1500000'); await p.fill('#budget', '1000000');
for (const t of ['없어요', '이번 주 안에']) await p.locator('.modal .seg button, .modal button', { hasText: t }).first().click();
await p.evaluate(() => { const g = [...document.querySelectorAll('.modal .field')].find(f => /불편/.test(f.innerText)); g && g.querySelector('button').click(); });
await p.locator('.modal button[type="submit"]').click(); await p.waitForTimeout(300);
await p.locator('.modal .prio').nth(1).click(); await p.locator('.modal button', { hasText: '표결 시작' }).click(); await p.waitForTimeout(500);
await p.click('#chat-skip'); await p.waitForTimeout(400);
const sh = await modal(p);
ok('QA3 예산 초과 → 보류(총리 직권)', sh.includes('보류') && sh.includes('직권'));
await clear(p);

// [QA4-a] 날씨 정상: 비 80% → 신중주의가 실내로 표 이동 + 요약에 반영
await intake(p, { title: '토요일 뭐 할까?', cat: '나들이', place: '강릉', opts: ['바다 산책', '카페'], tags: ['out', 'in'] });
await answer(p, ['바다 산책', '바다 산책', '바다 산책', '바다 산책'], 0);
const wx = await modal(p);
ok('QA4 근거: 출처·조회 시각 표시', wx.includes('Open-Meteo(테스트)') && wx.includes('조회'));
ok('QA4 비 예보 → 표 조정이 요약에 표시', wx.includes('근거로 조정'));
await clear(p);
// [QA4-b] API 장애
const p2 = await page(1280, 860, 'down');
await intake(p2, { title: '토요일 뭐 할까?', cat: '나들이', place: '강릉', opts: ['바다 산책', '카페'], tags: ['out', 'in'] });
const stillIntake = await p2.locator('#agenda-form').count();
if (!stillIntake) await answer(p2, ['바다 산책', '카페', '바다 산책', '카페'], 0);
const down = await modal(p2);
ok('QA4 API 장애 → 실패 표시 후 판결 정상 진행', !stillIntake && down.includes('반영하지 않고') && down.includes('판결'), stillIntake ? '접수 단계에서 막힘' : '');
await p2.close();

// [QA5] 로그인 전 저장 범위 + 1-4 판결 이후 기록(체험 모드)
await p.click('[data-action="records"] >> visible=true'); await p.waitForTimeout(300);
let rec = await modal(p);
ok('QA5 비로그인: 체험 모드 안내(브라우저에만 저장)', rec.includes('체험 모드') && rec.includes('브라우저) 안에만') && rec.includes('옮겨지지 않아요'));
await p.locator('.record-detail summary').first().click(); await p.waitForTimeout(150);
if (await p.locator('.record-detail').first().locator('[data-fu-now]').count()) await p.locator('.record-detail').first().locator('[data-fu-now]').click(); // 토요일 일정이라 '지금 남기기'
await p.locator('.record-detail').first().locator('[data-did="true"]').click(); await p.waitForTimeout(200);
await p.locator('.record-detail').first().locator('[data-sat="4"]').click(); await p.waitForTimeout(200);
ok('1-4 실행·만족도 저장 표시', (await p.locator('.record-detail').first().locator('.fu-note').innerText()).includes('저장했어요') && (await p.locator('.record-detail').first().locator('.fu-badge').innerText()) === '✅★4');
const stored = await p.evaluate(() => JSON.parse(localStorage.getItem('decision-country-records'))[0]);
ok('1-4 새로고침 후에도 유지(브라우저 저장)', stored.didIt === true && stored.satisfaction === 4);
await clear(p);
await p.click('[data-action="stats"] >> visible=true'); await p.waitForTimeout(300);
const st = await modal(p);
ok('1-4 통계: 실행률·평균 만족도·유형 분포', st.includes('실행률') && st.includes('100%') && st.includes('4.0') && st.includes('고민 유형 분포'), st.split('판결 이후')[1]);
await clear(p);

// [QA6] 여론: 정렬, 판결 vs 여론, 로그인 후 복귀
await p.evaluate(() => { const S = window.__S, now = Date.now();
  S.polls.push({ id: 'p1', user_id: 'uid-A', title: '먼저 올린 글', category: '일상', options: ['가', '나'], created_at: new Date(now - 7200e3).toISOString(), closes_at: new Date(now + 50 * 3600e3).toISOString(), minister_pick: 0 });
  S.polls.push({ id: 'p2', user_id: 'uid-A', title: '나중에 올린 글', category: '일상', options: ['다', '라'], created_at: new Date(now - 60e3).toISOString(), closes_at: new Date(now + 2 * 3600e3).toISOString() });
  S.votes.push({ poll_id: 'p1', user_id: 'x1', option_index: 1 }, { poll_id: 'p1', user_id: 'x2', option_index: 1 }); });
await p.click('[data-action="polls"] >> visible=true'); await p.waitForTimeout(300);
const order = async () => (await p.locator('.poll-title').allInnerTexts()).join(' / ');
ok('1-5 정렬: 마감 임박', (await order()).startsWith('나중에'), await order());
await p.click('[data-psort="hot"]'); await p.waitForTimeout(250);
ok('1-5 정렬: 참여 많은 순', (await order()).startsWith('먼저'), await order());
await p.click('[data-psort="new"]'); await p.waitForTimeout(250);
ok('1-5 정렬: 최신', (await order()).startsWith('나중에'), await order());
const cmp = await p.locator('.poll-compare').innerText();
ok('1-5 진행 중 여론: 투표 전에는 결과 숨김(쏠림 방지)', cmp.includes('장관 판결: 가') && cmp.includes('투표하면') && !(await p.locator('.poll-card .tally').count()), cmp);
await p.click('#poll-login'); await p.waitForTimeout(200);
await p.fill('#auth-email', 'b@test.com'); await p.fill('#auth-pw', 'secret12a');
await p.locator('#auth-form button[type="submit"]').click(); await p.waitForTimeout(1200);
ok('1-5 로그인 후 국민 여론으로 복귀', (await modal(p)).includes('국민 여론 광장') && (await p.locator('[data-vote]').count()) > 0);
await p.locator('[data-poll-id="p1"] [data-vote]').nth(1).click(); await p.waitForTimeout(500);
const cmp2 = await p.locator('[data-poll-id="p1"] .poll-compare').innerText();
ok('1-5 투표 후 장관 판결 vs 국민 여론 + 표본 적음 안내', cmp2.includes('장관 판결: 가') && cmp2.includes('국민 여론 1위: 나') && cmp2.includes('표본이 적어요'), cmp2);
const dup = await p.evaluate(async () => { await db.from('poll_votes').insert({ poll_id: 'p2', option_index: 0 }); return (await db.from('poll_votes').insert({ poll_id: 'p2', option_index: 1 })).error?.message; });
ok('QA6 여론 중복 투표 차단(실DB는 별도 SQL·실사이트로 확인)', /duplicate/.test(dup || ''));
await clear(p);

// [QA8] 공유 개인정보 확인 (체험 모드 기록으로)
await p.evaluate(async () => { await db.auth.signOut(); }); await p.waitForTimeout(300);
await p.click('[data-action="records"] >> visible=true'); await p.waitForTimeout(300);
await p.locator('.record-detail summary').first().click(); await p.locator('[data-share="0"]').click(); await p.waitForTimeout(400);
const shr = await modal(p);
ok('QA8 공유 전 개인정보 안내', shr.includes('다른 사람에게 보입니다'));
await clear(p);
ok('PC: 자바스크립트 오류 없음', !p.errs.length, p.errs.join('|'));

// [QA7] 모바일 360·390: 대화·버튼 가림
for (const w of [360, 390]) {
  const m = await page(w, 760);
  await intake(m, { title: '오늘 저녁 뭐 먹지?', opts: ['마라탕', '김치찌개'] });
  await answer(m, ['마라탕', '김치찌개', '마라탕', '김치찌개'], 0);
  const overflow = await m.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1 || [...document.querySelectorAll('.modal *')].some(el => el.getBoundingClientRect().right > innerWidth + 1));
  const btns = await m.evaluate(() => [...document.querySelectorAll('.modal button')].filter(x => x.offsetParent).every(x => { const r = x.getBoundingClientRect(); return r.height >= 30; }));
  await m.locator('.modal').screenshot({ path: path.join(HERE, 'out', `qa-mobile-${w}.png`) });
  ok(`QA7 모바일 ${w}px: 가로 넘침 없음·버튼 높이 충분·오류 없음`, !overflow && btns && !m.errs.length, m.errs.join('|'));
  await m.close();
}
await b.close();
console.log(out.join('\n')); console.log(`\n${out.filter(x => x.startsWith('PASS')).length}/${out.length} 통과`);
