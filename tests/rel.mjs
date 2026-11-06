import { chromium } from 'playwright';
import { mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.env.BASE_URL || 'http://127.0.0.1:8771';
mkdirSync(path.join(HERE, 'out'), { recursive: true });
import fs from 'fs';
const fake = fs.readFileSync(path.join(HERE, 'fake3.js'), 'utf8');
const b = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH, args: ['--no-sandbox'] } : { args: ['--no-sandbox'] });
const out = []; const ok = (n, c, x = '') => out.push(`${c ? 'PASS' : 'FAIL'}  ${n}${x ? '  → ' + String(x).replace(/\s+/g, ' ').slice(0, 160) : ''}`);
async function page(w, h = 900, pre = '') {
  const p = await b.newPage({ viewport: { width: w, height: h } });
  p.errs = []; p.on('pageerror', e => p.errs.push(e.message)); p.on('dialog', d => { p.dialog = d.message(); d.dismiss(); });
  await p.route('**/*', r => { const u = r.request().url();
    // 테스트는 가짜 서버(fake*.js)를 끼우므로 SRI 무결성 검사만 테스트 페이지에서 뺀다(실제 사이트는 그대로)
    if (u.endsWith('/index.html')) return r.fetch().then(async resp => r.fulfill({ response: resp, body: (await resp.text()).replace(/ integrity="[^"]+"/g, '') }));
    if (u.includes('supabase-js')) return r.fulfill({ contentType: 'application/javascript', body: fake + pre });
    if (u.includes('/api/info')) return r.fulfill({ contentType: 'application/json', body: '{"ok":false,"reason":"테스트"}' });
    if (u.startsWith(BASE)) return r.continue(); return r.abort(); });
  await p.goto(BASE + '/index.html'); await p.waitForTimeout(300); return p;
}
async function verdict(p, title = '점심 뭐 먹지', opts = ['국밥', '파스타'], cat = '일상') {
  await p.click('[data-action="meeting"] >> visible=true'); await p.waitForTimeout(200);
  if (await p.locator('#resume-new').count()) { await p.click('#resume-new'); await p.waitForTimeout(150); }
  await p.locator(`.modal [data-cat="${cat}"]`).click(); await p.waitForTimeout(100);
  await p.fill('#meeting-title', title);
  for (let i = 0; i < opts.length; i++) { if (i >= 2) await p.locator('#add-opt').click(); await p.locator('.opt-input').nth(i).fill(opts[i]); }
  await p.locator('#agenda-form button[type="submit"]').click(); await p.waitForTimeout(400);
  for (let k = 0; k < 4; k++) { await p.locator('.modal .choice').first().click(); await p.waitForTimeout(150); }
  await p.locator('.modal .prio').first().click(); await p.locator('.modal button', { hasText: '표결 시작' }).click(); await p.waitForTimeout(700);
  if (await p.locator('[data-tb]').count()) { await p.locator('[data-tb]').first().click(); await p.waitForTimeout(400); }
}
const login = async p => { await p.evaluate(() => document.getElementById('modal-root').innerHTML = ''); await p.click('.login-btn'); await p.fill('#auth-email', 'a@test.com'); await p.fill('#auth-pw', 'secret12a'); await p.locator('#auth-form button[type="submit"]').click(); await p.waitForTimeout(1200); await p.evaluate(() => document.getElementById('modal-root').innerHTML = ''); };

// 1. 유형별 제목 예시
{ const p = await page(1440);
  await p.click('[data-action="meeting"] >> visible=true'); await p.waitForTimeout(200);
  const ph = {};
  for (const c of ['나들이', '맛집', '쇼핑', '일상']) { await p.locator(`.modal [data-cat="${c}"]`).click(); await p.waitForTimeout(120); ph[c] = await p.getAttribute('#meeting-title', 'placeholder'); }
  ok('R1 유형별 고민 제목 예시가 서로 다름', new Set(Object.values(ph)).size === 4 && /놀러/.test(ph.나들이) && /살까/.test(ph.쇼핑) && /운동/.test(ph.일상), JSON.stringify(ph));
  // 2. 판결 화면: 회의록(대화)이 위, 판결서가 아래
  await p.evaluate(() => document.getElementById('modal-root').innerHTML = '');
  await verdict(p);
  const order = await p.evaluate(() => { const c = document.getElementById('chat'), d = document.querySelector('.decree'); return c && d ? !!(c.compareDocumentPosition(d) & Node.DOCUMENT_POSITION_FOLLOWING) : null; });
  const chatVisible = await p.evaluate(() => { const c = document.getElementById('chat').getBoundingClientRect(); return c.top < innerHeight; });
  ok('R2 판결 화면: 장관 대화(회의록)가 먼저, 최종 판결서는 맨 아래', order === true && chatVisible, `order=${order} chatVisible=${chatVisible}`);
  const hiddenWhileTalking = await p.evaluate(() => document.getElementById('after-minutes').hidden && !document.querySelector('.decree').getClientRects().length);
  await p.click('#chat-skip'); await p.waitForTimeout(300);
  const shownAfter = await p.evaluate(() => !document.getElementById('after-minutes').hidden && document.querySelector('.decree').getClientRects().length > 0);
  ok('R2b 최종 판결서는 장관 대화가 끝난 뒤에 나타남', hiddenWhileTalking && shownAfter, `talking=${hiddenWhileTalking} after=${shownAfter}`);
  // 3. 개별 삭제 확인(체험 모드)
  await p.evaluate(() => document.getElementById('modal-root').innerHTML = '');
  await p.click('[data-action="records"] >> visible=true'); await p.waitForTimeout(300);
  await p.locator('.record-detail summary').first().click();
  await p.locator('[data-delete]').first().click(); await p.waitForTimeout(150);
  const n0 = await p.evaluate(() => JSON.parse(localStorage.getItem('decision-country-records')).length);
  const confirmShown = await p.locator('.del-confirm').isVisible();
  await p.locator('[data-del-no]').click(); await p.waitForTimeout(100);
  const n1 = await p.evaluate(() => JSON.parse(localStorage.getItem('decision-country-records')).length);
  ok('R3 기록 삭제: 확인 전에는 지우지 않고, 취소하면 그대로', confirmShown && n0 === 1 && n1 === 1 && !p.dialog, `confirm=${confirmShown} ${n0}->${n1}`);
  await p.locator('[data-delete]').first().click(); await p.locator('[data-del-yes]').click(); await p.waitForTimeout(400);
  const n2 = await p.evaluate(() => JSON.parse(localStorage.getItem('decision-country-records')).length);
  const undo = await p.locator('#rec-undo').count();
  await p.locator('#rec-undo').click(); await p.waitForTimeout(300);
  const n3 = await p.evaluate(() => JSON.parse(localStorage.getItem('decision-country-records')).length);
  ok('R4 삭제 승인 시 1건만 삭제 · 되돌리기로 복구(체험 모드)', n2 === 0 && undo === 1 && n3 === 1, `${n2} undo=${undo} ${n3}`);
  // 4. 전체 삭제: 건수·위치 표시, '삭제' 입력 전엔 버튼 비활성, 취소 시 보존
  await p.evaluate(() => document.getElementById('modal-root').innerHTML = '');
  await p.click('[data-action="settings"] >> visible=true'); await p.waitForTimeout(200);
  await p.click('#clear-records'); await p.waitForTimeout(300);
  const boxText = await p.locator('#clear-box').innerText();
  const dis0 = await p.locator('#clear-yes').isDisabled();
  await p.fill('#clear-word', '삭'); const dis1 = await p.locator('#clear-yes').isDisabled();
  await p.click('#clear-no'); const n4 = await p.evaluate(() => JSON.parse(localStorage.getItem('decision-country-records')).length);
  ok('R5 전체 삭제: 건수·저장 위치 표시, 입력 전 비활성, 취소 시 보존', /1건/.test(boxText) && /이 브라우저/.test(boxText) && dis0 && dis1 && n4 === 1, boxText);
  await p.click('#clear-records'); await p.waitForTimeout(300); await p.fill('#clear-word', '삭제'); await p.click('#clear-yes'); await p.waitForTimeout(300);
  const n5 = await p.evaluate(() => (JSON.parse(localStorage.getItem('decision-country-records') || '[]')).length);
  ok('R6 전체 삭제: "삭제" 입력 후에만 실행', n5 === 0, n5);
  ok('R0 페이지 오류 없음(체험)', !p.errs.length, p.errs.join(' | '));
  await p.close(); }

// 5. 저장 실패 → 결과 보존 → 다시 저장 1회만
{ const p = await page(1440);
  await login(p);
  await p.evaluate(() => { window.__S.failInsert = 1; });
  await verdict(p, '저장 실패 테스트', ['A', 'B']);
  await p.click('#chat-skip'); await p.waitForTimeout(500);
  const t1 = await p.locator('#decree-save').innerText();
  const pend = await p.evaluate(() => !!localStorage.getItem('decision-country-pending'));
  const retry = await p.locator('#decree-retry').count();
  ok('R7 저장 실패: 성공 문구 없이 실패 안내 + 결과 보관 + 다시 저장 버튼', /기록하지 못했어요/.test(t1) && pend && retry === 1, t1);
  await p.click('#decree-retry'); await p.waitForTimeout(400);
  const t2 = await p.locator('#decree-save').innerText();
  const cnt = await p.evaluate(() => window.__S.decisions.length);
  const pend2 = await p.evaluate(() => !!localStorage.getItem('decision-country-pending'));
  ok('R8 다시 저장: 1건 저장, 보관함 비움, 성공 문구', /적어 두었습니다/.test(t2) && cnt === 1 && !pend2, `${t2} cnt=${cnt}`);
  // 같은 판결을 또 저장해도 중복 없음(같은 id)
  const dup = await p.evaluate(async () => { const d = window.__S.decisions[0]; const r = await window.supabase.createClient().from('decisions').insert({ ...d }); return r.error && r.error.code; });
  ok('R9 같은 판결 id로 다시 넣으면 중복 생성 거부(23505 → 이미 저장으로 처리)', dup === '23505', dup);
  // 창을 닫았다 열어도(새로고침) 저장 못 한 판결이 홈에 남음
  await p.evaluate(() => { window.__S.failInsert = 5; });
  await p.evaluate(() => document.getElementById('modal-root').innerHTML = '');
  await verdict(p, '새로고침 보존', ['A', 'B']);
  await p.waitForTimeout(400);
  await p.evaluate(() => document.getElementById('modal-root').innerHTML = '');
  const row = await p.locator('#pend-retry').count();
  ok('R10 저장 못 한 판결이 홈 "최근 결정 기록" 맨 위에 다시 저장 줄로 남음', row === 1);
  ok('R0b 페이지 오류 없음(로그인)', !p.errs.length, p.errs.join(' | '));
  await p.close(); }

// 6. 여론 불러오기 실패 ≠ 글 없음
{ const p = await page(1440, 900, ';window.__S.failBoard = true;');
  await p.waitForTimeout(300);
  const home = await p.locator('#poll-home').innerText();
  ok('R11 홈 여론: 연결 실패를 "글 없음"으로 표시하지 않고 다시 시도 제공', /불러오지 못했어요/.test(home) && !/없어요\. 첫 고민/.test(home) && await p.locator('#poll-home-retry').count() === 1, home);
  await p.click('[data-action="polls"] >> visible=true'); await p.waitForTimeout(400);
  const m = await p.locator('.modal').innerText();
  ok('R12 여론 광장: 실패 안내 + 다시 시도, "진행 중인 여론조사가 없어요" 미표시', /불러오지 못했어요/.test(m) && !/진행 중인 여론조사가 없어요/.test(m) && await p.locator('#poll-retry').count() === 1, m.slice(0, 120));
  await p.evaluate(() => { window.__S.failBoard = false; window.__S.polls.push({ id: 'poll-x', title: '영화 vs 전시', category: '일상', options: ['영화', '전시'], user_id: 'uid-B', created_at: new Date().toISOString(), closes_at: new Date(Date.now() + 3600e3).toISOString(), hidden: false }); });
  await p.click('#poll-retry'); await p.waitForTimeout(400);
  ok('R13 다시 시도 → 회복 시 정상 목록', await p.locator('.poll-card').count() === 1);
  await p.close(); }

// 7. 신고 사유 + 게시 전 입력 제한
{ const p = await page(1440);
  await p.evaluate(() => window.__S.polls.push({ id: 'poll-y', title: '점심 메뉴 고민', category: '맛집', options: ['국밥', '쌀국수'], user_id: 'uid-B', created_at: new Date().toISOString(), closes_at: new Date(Date.now() + 3600e3).toISOString(), hidden: false }));
  await login(p);
  await p.click('[data-action="polls"] >> visible=true'); await p.waitForTimeout(400);
  await p.click('[data-preport]'); await p.waitForTimeout(150);
  const reasons = await p.locator('[data-reason]').allInnerTexts();
  await p.locator('[data-reason="광고"]').click(); await p.waitForTimeout(400);
  const sent = await p.evaluate(() => window.__S.lastReport);
  ok('R14 신고: 사유 4가지 중 선택 → 사유가 함께 저장, 브라우저 확인창 없음', reasons.join(',') === '개인정보,욕설,광고,기타' && sent && sent.reason === '광고' && !p.dialog, JSON.stringify(sent));
  await p.click('#poll-new'); await p.waitForTimeout(300);
  await p.fill('#poll-title', '뭐?'); await p.locator('.poll-opt').nth(0).fill('a'); await p.locator('.poll-opt').nth(1).fill('b');
  await p.locator('.modal form button[type="submit"]').click(); await p.waitForTimeout(200);
  const e1 = await p.locator('.modal').innerText();
  await p.fill('#poll-title', '연락 010-1234-5678 주세요'); await p.locator('.modal form button[type="submit"]').click(); await p.waitForTimeout(200);
  const e2 = await p.locator('.modal').innerText();
  ok('R15 여론 글쓰기: 4자 미만·전화번호 차단', /4자 이상/.test(e1) && /개인정보는 올릴 수 없어요/.test(e2));
  await p.close(); }

// 8. 모달 키보드: 포커스 이동·순환·복귀
{ const p = await page(1440);
  const btn = p.locator('.main-nav [data-action="records"]'); await btn.focus(); await p.keyboard.press('Enter'); await p.waitForTimeout(300);
  const inModal = await p.evaluate(() => !!document.activeElement.closest('.modal'));
  let escaped = false;
  for (let i = 0; i < 25; i++) { await p.keyboard.press('Tab'); if (!(await p.evaluate(() => !!document.activeElement.closest('.modal')))) escaped = true; }
  for (let i = 0; i < 8; i++) { await p.keyboard.press('Shift+Tab'); if (!(await p.evaluate(() => !!document.activeElement.closest('.modal')))) escaped = true; }
  const inert = await p.evaluate(() => document.querySelector('main').hasAttribute('inert') && document.documentElement.classList.contains('modal-open'));
  await p.keyboard.press('Escape'); await p.waitForTimeout(150);
  const back = await p.evaluate(() => document.activeElement && document.activeElement.matches('.main-nav [data-action="records"]'));
  const freed = await p.evaluate(() => !document.querySelector('main').hasAttribute('inert'));
  ok('R16 모달: 열면 모달로 포커스, Tab/Shift+Tab이 모달 밖으로 안 나감, 뒤 화면 잠금', inModal && !escaped && inert, `in=${inModal} esc=${escaped} inert=${inert}`);
  ok('R17 모달: Esc로 닫으면 연 버튼으로 포커스 복귀·잠금 해제', back && freed);
  await p.close(); }

// 9. 모바일 360/390: 고민 유형 5개 한눈에, 44px
for (const w of [360, 390]) { const p = await page(w, 800);
  const r = await p.evaluate(() => { const box = document.querySelector('.categories'); const cs = [...box.querySelectorAll('.category')].map(c => c.getBoundingClientRect());
    return { all: cs.every(c => c.left >= 0 && c.right <= innerWidth), minH: Math.min(...cs.map(c => c.height)), sw: box.scrollWidth, cw: box.clientWidth, docw: document.documentElement.scrollWidth }; });
  ok(`R18 모바일 ${w}px: 유형 5개 가로 스크롤 없이 표시, 높이 ≥44px, 페이지 가로 넘침 없음`, r.all && r.minH >= 44 && r.sw <= r.cw + 1 && r.docw <= w, JSON.stringify(r));
  await p.close(); }

// 10. 공유 이미지: 6개 선택지·긴 제목에서도 오류 없이 1080×1080, 크림 배경
{ const p = await page(1440);
  const r = await p.evaluate(() => { const rec = { title: '아주 아주 긴 고민 제목입니다 정말로 길게 적어서 두 줄을 넘기면 말줄임이 되는지 확인해 봅시다 ㅎㅎ', verdict: '「아주 긴 선택지 이름 여섯 번째까지 테스트」로 결정!', label: '박빙 판결', category: '일상', date: '2026.11.06',
      options: ['선택지 하나 아주 길게 길게 길게', '둘', '셋', '넷', '다섯', '여섯 <b>특수</b> & "문자"'], counts: [1.5, 1, 0, 1, 0, 0], winner: 0 };
    const c = drawVerdictImage(rec); const d = c.getContext('2d').getImageData(10, 10, 1, 1).data;
    const c2 = drawVerdictImage({ ...rec, winner: -1, label: '판단 보류', verdict: '판단 보류', options: ['한다', '안 한다'], counts: [0, 0] });
    return { w: c.width, h: c.height, px: [...d].slice(0, 3), ok2: c2.width === 1080 }; });
  ok('R19 공유 이미지: 6개·긴 제목·특수문자·판단 보류에서 오류 없이 1080×1080, 크림 배경(#F8F3EA)', r.w === 1080 && r.h === 1080 && r.ok2 && Math.abs(r.px[0] - 0xF8) < 6 && Math.abs(r.px[2] - 0xEA) < 10, JSON.stringify(r));
  ok('R0c 페이지 오류 없음', !p.errs.length, p.errs.join(' | '));
  await p.close(); }

// 11. 개인정보 페이지 모바일 가로 넘침
{ const p = await b.newPage({ viewport: { width: 360, height: 800 } });
  await p.route('**/*', r => r.request().url().startsWith(BASE + '') ? r.continue() : r.abort());
  await p.goto(BASE + '/privacy.html'); await p.waitForTimeout(200);
  const r = await p.evaluate(() => ({ docw: document.documentElement.scrollWidth, bg: getComputedStyle(document.body).backgroundColor, issues: !!document.querySelector('a[href*="issues"]') }));
  ok('R20 개인정보 안내: 새 색상(크림), 360px 가로 넘침 없음(표는 표 안에서만 스크롤), 문의 경로', r.docw <= 360 && r.bg === 'rgb(248, 243, 234)' && r.issues, JSON.stringify(r));
  await p.screenshot({ path: path.join(HERE, 'out', 'privacy-360.png'), fullPage: false }); await p.close(); }

console.log(out.join('\n')); console.log(`\n${out.filter(l => l.startsWith('PASS')).length}/${out.length} 통과`);
await b.close();
