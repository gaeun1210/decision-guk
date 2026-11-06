// 보안 회귀 테스트: XSS(사용자 입력이 HTML·스크립트로 실행되지 않는지), 외부 스크립트 SRI, 장관 판결 기록 연결, 숨김 글 표시
import { chromium } from 'playwright';
import { mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.env.BASE_URL || 'http://127.0.0.1:8771';
mkdirSync(path.join(HERE, 'out'), { recursive: true });
const fake = fs.readFileSync(path.join(HERE, 'fake3.js'), 'utf8');
const b = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH, args: ['--no-sandbox'] } : { args: ['--no-sandbox'] });
const out = []; const ok = (n, c, x = '') => out.push(`${c ? 'PASS' : 'FAIL'}  ${n}${x ? '  → ' + String(x).replace(/\s+/g, ' ').slice(0, 160) : ''}`);
const X1 = '<img src=x onerror="window.__xss=1">', X2 = '"><svg onload="window.__xss=2">', X3 = "'><script>window.__xss=3</script>";
async function page(w = 1440, h = 900) {
  const p = await b.newPage({ viewport: { width: w, height: h } });
  p.errs = []; p.on('pageerror', e => p.errs.push(e.message)); p.on('dialog', d => { p.dialog = d.message(); d.dismiss(); });
  await p.route('**/*', r => { const u = r.request().url();
    if (u.endsWith('/index.html')) return r.fetch().then(async resp => r.fulfill({ response: resp, body: (await resp.text()).replace(/ integrity="[^"]+"/g, '') }));
    if (u.includes('supabase-js')) return r.fulfill({ contentType: 'application/javascript', body: fake });
    if (u.includes('/api/info')) return r.fulfill({ contentType: 'application/json', body: '{"ok":false,"reason":"테스트"}' });
    if (u.startsWith(BASE)) return r.continue(); return r.abort(); });
  await p.goto(BASE + '/index.html'); await p.waitForTimeout(300); return p;
}
const injected = p => p.evaluate(() => ({ flag: window.__xss || null, nodes: document.querySelectorAll('img[src="x"], svg[onload], script:not([src])').length }));
async function verdict(p, title, opts, detail) {
  await p.click('[data-action="meeting"] >> visible=true'); await p.waitForTimeout(200);
  if (await p.locator('#resume-new').count()) { await p.click('#resume-new'); await p.waitForTimeout(150); }
  await p.locator('.modal [data-cat="일상"]').click(); await p.waitForTimeout(100);
  await p.fill('#meeting-title', title);
  for (let i = 0; i < opts.length; i++) { if (i >= 2) await p.locator('#add-opt').click(); await p.locator('.opt-input').nth(i).fill(opts[i]); }
  if (detail) { await p.locator('.modal summary, .modal details > summary').first().click().catch(() => {}); await p.fill('#meeting-detail', detail).catch(() => {}); }
  await p.locator('#agenda-form button[type="submit"]').click(); await p.waitForTimeout(400);
  for (let k = 0; k < 4; k++) { // 선택지마다 등급을 다르게(첫 선택지가 가장 좋게) 답한다
    const rows = p.locator('.modal .fact-row:not(.auto)'); const n = await rows.count();
    for (let i = 0; i < n; i++) await rows.nth(i).locator('.fact').nth(Math.min(i, 2)).click();
    await p.click('#q-next'); await p.waitForTimeout(150); }
  await p.locator('.modal .prio').first().click(); await p.locator('.modal button', { hasText: '표결 시작' }).click(); await p.waitForTimeout(700);
  if (await p.locator('[data-tb]').count()) { await p.locator('[data-tb]').first().click(); await p.waitForTimeout(400); }
  if (await p.locator('#chat-skip').count()) { await p.click('#chat-skip'); await p.waitForTimeout(400); }
}

// S1 국무회의 입력(제목·선택지·내용) → 판결·회의록·판결서·기록실·홈·공유 화면
{ const p = await page();
  await verdict(p, X1, [X2, X3], X1 + X2);
  let r = await injected(p);
  const shown = await p.locator('.modal').innerText();
  ok('S1 XSS: 판결 화면(회의록·판결서)에서 입력이 실행되지 않고 글자로만 보임', !r.flag && !r.nodes && shown.includes('<img src=x'), JSON.stringify(r));
  await p.click('#result-share'); await p.waitForTimeout(500);
  r = await injected(p); ok('S2 XSS: 공유 화면', !r.flag && !r.nodes, JSON.stringify(r));
  await p.evaluate(() => document.getElementById('modal-root').innerHTML = '');
  await p.click('[data-action="records"] >> visible=true'); await p.waitForTimeout(300);
  await p.locator('.record-detail summary').first().click(); await p.waitForTimeout(150);
  await p.locator('[data-delete]').first().click(); await p.waitForTimeout(150);
  r = await injected(p); ok('S3 XSS: 결정 기록실(펼침·삭제 확인 문구)', !r.flag && !r.nodes, JSON.stringify(r));
  await p.evaluate(() => document.getElementById('modal-root').innerHTML = '');
  r = await injected(p); ok('S4 XSS: 홈 최근 결정 기록', !r.flag && !r.nodes && (await p.locator('#recent-list').innerText()).includes('<'), JSON.stringify(r));
  ok('S0 페이지 오류 없음', !p.errs.length, p.errs.join(' | '));
  await p.close(); }

// S5 국민 여론: 남이 올린 악성 제목·선택지 + 숨김 글 안내 + 장관 판결 기록 연결
{ const p = await page();
  await p.evaluate(([a, b2, c]) => {
    const t = new Date(Date.now() + 3600e3).toISOString(), n = new Date().toISOString();
    window.__S.polls.push({ id: 'px', title: a, category: '일상', options: [b2, c], user_id: 'uid-B', created_at: n, closes_at: t, hidden: false });
    window.__S.polls.push({ id: 'ph', title: '내 숨겨진 글', category: '일상', options: ['가', '나'], user_id: 'uid-A', created_at: n, closes_at: t, hidden: true });
  }, [X1, X2, X3]);
  await p.evaluate(() => renderPollPanel());
  await p.waitForTimeout(300);
  let r = await injected(p); ok('S5 XSS: 홈 국민 여론 패널', !r.flag && !r.nodes, JSON.stringify(r));
  await p.click('.login-btn'); await p.fill('#auth-email', 'a@test.com'); await p.fill('#auth-pw', 'secret12a');
  await p.locator('#auth-form button[type="submit"]').click(); await p.waitForTimeout(1200);
  await p.evaluate(() => document.getElementById('modal-root').innerHTML = '');
  await p.click('[data-action="polls"] >> visible=true'); await p.waitForTimeout(500);
  r = await injected(p); ok('S6 XSS: 여론 광장 목록·선택지 버튼', !r.flag && !r.nodes, JSON.stringify(r));
  const hiddenNote = await p.locator('[data-poll-id="ph"] .hidden-note').count();
  const homeHasHidden = (await p.locator('#poll-home').innerText()).includes('내 숨겨진 글');
  ok('S7 숨겨진 내 글: 여론 광장에 "숨겨진 글" 안내, 홈 패널에는 안 띄움', hiddenNote === 1 && !homeHasHidden, `note=${hiddenNote} home=${homeHasHidden}`);
  // 판결 → 국민 여론에 물어보기: 장관 판결은 저장된 판결 기록(decision_id)과 함께 전송
  await p.evaluate(() => document.getElementById('modal-root').innerHTML = '');
  await verdict(p, '점심 메뉴 고민', ['국밥', '파스타']);
  await p.waitForTimeout(400);
  await p.click('#result-poll'); await p.waitForTimeout(400);
  await p.locator('.modal form button[type="submit"]').click(); await p.waitForTimeout(500);
  const sent = await p.evaluate(() => { const d = window.__S.decisions.at(-1), q = window.__S.polls.at(-1); return { did: d && d.id, pdid: q && q.decision_id, pick: q && q.minister_pick }; });
  ok('S8 장관 판결 표시는 내 판결 기록 id와 함께 전송(서버 검증용)', sent.did && sent.pdid === sent.did && Number.isInteger(sent.pick), JSON.stringify(sent));
  ok('S0b 페이지 오류 없음', !p.errs.length, p.errs.join(' | '));
  await p.close(); }

// S9 외부 스크립트·스타일 SRI
{ const files = ['index.html', 'privacy.html'].map(f => [f, fs.readFileSync(path.join(HERE, '..', f), 'utf8')]);
  const bad = [];
  for (const [f, html] of files) for (const tag of html.match(/<(script|link)[^>]+(src|href)="https?:\/\/[^"]+"[^>]*>/g) || []) {
    if (!/integrity="sha384-[A-Za-z0-9+/=]{64}"/.test(tag) || !/crossorigin="anonymous"/.test(tag)) bad.push(f + ': ' + tag.slice(0, 80));
  }
  ok('S9 외부 CDN 스크립트·스타일에 SRI(sha384)·crossorigin 지정', !bad.length, bad.join(' | '));
  const csp = JSON.parse(fs.readFileSync(path.join(HERE, '..', 'vercel.json'), 'utf8')).headers[0].headers.find(h => h.key === 'Content-Security-Policy').value;
  ok('S10 CSP: 인라인 스크립트 불허, 스크립트 출처 제한, object-src none, frame-ancestors none', /script-src 'self' https:\/\/cdn\.jsdelivr\.net;/.test(csp) && !/script-src[^;]*unsafe-inline/.test(csp) && /object-src 'none'/.test(csp) && /frame-ancestors 'none'/.test(csp), csp.slice(0, 120));
  const app = fs.readFileSync(path.join(HERE, '..', 'app.js'), 'utf8');
  ok('S11 화면 코드에 service_role/secret 키 없음(공개 키만)', !/sb_secret_\w|eyJhbGciOi[\w-]+\.[\w-]+/.test(app) && /sb_publishable_/.test(app)); }

console.log(out.join('\n')); console.log(`\n${out.filter(l => l.startsWith('PASS')).length}/${out.length} 통과`);
await b.close();
