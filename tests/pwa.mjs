// 앱 버전(홈 화면에 추가, PWA) 검사: 설치 정보(manifest)·아이콘·서비스 워커·오프라인 열기·데이터 미저장
import { chromium } from 'playwright';
import { mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.env.BASE_URL || 'http://127.0.0.1:8771';
mkdirSync(path.join(HERE, 'out'), { recursive: true });
const out = []; const ok = (n, c, x = '') => out.push(`${c ? 'PASS' : 'FAIL'}  ${n}${x ? '  → ' + String(x).replace(/\s+/g, ' ').slice(0, 160) : ''}`);
const b = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH, args: ['--no-sandbox'] } : { args: ['--no-sandbox'] });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'allow' });
await ctx.route('**/*', r => r.request().url().startsWith(BASE) ? r.continue() : r.abort());
const p = await ctx.newPage(); p.errs = []; p.on('pageerror', e => p.errs.push(e.message));
await p.goto(BASE + '/index.html'); await p.waitForTimeout(500);
const man = await p.evaluate(async () => { const l = document.querySelector('link[rel="manifest"]'); return l ? await (await fetch(l.href)).json() : null; });
ok('P-01 설치 정보(manifest): 이름·시작 주소·전체 화면·색·아이콘 192/512/maskable', man && man.short_name === '결정국' && man.display === 'standalone' && man.start_url && man.theme_color === '#854B45'
  && ['192x192', '512x512'].every(sz => man.icons.some(i => i.sizes === sz && i.purpose === 'any')) && man.icons.some(i => i.purpose === 'maskable'), JSON.stringify(man && man.icons));
const iconsOk = await p.evaluate(async m => (await Promise.all(m.icons.map(i => new Promise(res => { const im = new Image(); im.onload = () => res(im.naturalWidth + 'x' + im.naturalHeight === i.sizes); im.onerror = () => res(false); im.src = i.src; })))).every(Boolean), man);
ok('P-02 아이콘 파일이 실제로 있고 크기가 맞음', iconsOk);
await p.evaluate(() => navigator.serviceWorker.ready); await p.waitForTimeout(800);
const sw = await p.evaluate(async () => { const keys = await caches.keys(); const c = await caches.open(keys[0]); const reqs = (await c.keys()).map(r => new URL(r.url).pathname); return { active: !!(navigator.serviceWorker.controller || (await navigator.serviceWorker.getRegistration())?.active), keys, reqs }; });
ok('P-03 서비스 워커 등록 + 화면 파일 저장', sw.active && sw.reqs.includes('/app.js') && sw.reqs.includes('/style.css'), JSON.stringify(sw.keys));
await p.reload(); await p.waitForTimeout(600); // 서비스 워커가 페이지를 관리하도록 한 번 새로고침
await ctx.setOffline(true);
await p.reload().catch(() => {}); await p.waitForTimeout(800);
const off = await p.evaluate(() => ({ title: document.title, hero: !!document.querySelector('.hero h1'), app: typeof decide === 'function' }));
ok('P-04 인터넷이 끊겨도 앱이 열리고 판결 기능이 동작(체험 모드)', off.hero && off.app, JSON.stringify(off));
await ctx.setOffline(false);
const stored = await p.evaluate(async () => { const out = []; for (const k of await caches.keys()) { const c = await caches.open(k); out.push(...(await c.keys()).map(r => r.url)); } return out; });
ok('P-05 개인 데이터·조회 요청(Supabase·/api/)은 저장하지 않음', !stored.some(u => /supabase\.co|\/api\//.test(u)), stored.filter(u => /supabase|api/.test(u)).join(','));
const sh = await p.evaluate(() => { history.replaceState(null, '', '?open=records'); return true; });
await p.goto(BASE + '/index.html?open=records'); await p.waitForTimeout(800);
ok('P-06 앱 바로가기(?open=records) → 결정 기록실이 바로 열림', (await p.locator('.modal').innerText().catch(() => '')).includes('결정 기록실'));
const swSrc = fs.readFileSync(path.join(HERE, '..', 'sw.js'), 'utf8');
ok('P-07 서비스 워커는 다른 서버(CDN·Supabase) 요청을 가로채지 않음(보안 헤더 CSP에 막히지 않게)', /url\.origin !== self\.location\.origin\) return/.test(swSrc) && !/cdn\.jsdelivr/.test(swSrc.replace(/\/\/.*$/gm, '')));
ok('P-00 오류 없음', !p.errs.length, p.errs.join(' | '));
console.log(out.join('\n')); console.log(`\n${out.filter(l => l.startsWith('PASS')).length}/${out.length} 통과`);
await b.close();
