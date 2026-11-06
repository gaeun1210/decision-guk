// 장관 독립 판단 엔진(규칙 v2) 단위 테스트 — 화면 없이 decide()만 호출해 검증 (J-01 ~ J-07)
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
const p = await b.newPage();
p.errs = []; p.on('pageerror', e => p.errs.push(e.message));
await p.route('**/*', r => { const u = r.request().url();
  if (u.endsWith('/index.html')) return r.fetch().then(async resp => r.fulfill({ response: resp, body: (await resp.text()).replace(/ integrity="[^"]+"/g, '') }));
  if (u.includes('supabase-js')) return r.fulfill({ contentType: 'application/javascript', body: fake });
  if (u.startsWith(BASE)) return r.continue(); return r.abort(); });
await p.goto(BASE + '/index.html'); await p.waitForTimeout(300);
const out = []; const ok = (n, c, x = '') => out.push(`${c ? 'PASS' : 'FAIL'}  ${n}${x ? '  → ' + String(x).replace(/\s+/g, ' ').slice(0, 200) : ''}`);
const run = (spec) => p.evaluate(spec => {
  const m = { ...newMeeting(spec.title || '테스트'), ...spec };
  m.facts = { ...emptyFacts(), ...(spec.facts || {}) };
  const r = decide(m);
  return { winner: r.winner, verdict: r.verdict, tie: r.tie || null, votes: r.votes, label: r.label, scores: r.assess ? Object.fromEntries(Object.entries(r.assess).map(([k, a]) => [k, a.scores])) : null,
    abst: r.assess ? Object.fromEntries(Object.entries(r.assess).map(([k, a]) => [k, a.abstainWhy])) : null, moves: r.moves || [], debate: r.assess && r.winner >= 0 ? debateOf(m, r) : [], ops: opinionsOf(m, r).map(o => o.text) };
}, spec);

// J-01 사용자는 A(부산 여행)를 강하게 원하지만 비용이 크고 예산이 빠듯 → 곰·토끼는 B, 쿼카는 A
{ const r = await run({ category: '나들이', title: '부산 여행 갈까?', options: ['부산 여행', '집에서 쉬기'], priority: 'fun', budgetTight: true, timeTight: true,
    facts: { risk: [1, 0], appeal: [0, 2], cost: [2, 0], ready: [1, 0] } });
  ok('J-01 끌림은 낭만주의만: 쿼카는 여행, 곰·토끼는 비용·예산으로 집에서 쉬기', r.votes['낭만주의'] === 0 && r.votes['현실주의'] === 1 && r.votes['신중주의'] === 1, JSON.stringify(r.votes) + ' ' + JSON.stringify(r.scores));
  const notes = r.ops.filter(t => t.includes('마음이 「부산 여행」 쪽인 건 알지만'));
  ok('J-01b 장관이 사용자 선호와 다른 판단을 숨기지 않고 설명(한 번만)', notes.length === 1, notes[0]); }
// J-02 같은 입력 10회 → 같은 점수·표·결과
{ const spec = { category: '일상', options: ['운동', '쉬기', '공부'], priority: 'safe', facts: { risk: [0, 1, 2], appeal: [1, 0, 2], cost: [1, 0, 1], ready: [0, 0, 1] } };
  const rs = []; for (let i = 0; i < 10; i++) rs.push(JSON.stringify(await run(spec)));
  ok('J-02 같은 입력 10회 반복 → 점수·표·결과 동일(결정적)', new Set(rs).size === 1); }
// J-03 장관 판단이 충돌하면 반대 의견과 반론이 표시되고, 근거 없이 표를 바꾸지 않음
{ const r = await run({ category: '일상', options: ['A', 'B'], priority: 'cost', facts: { risk: [2, 0], appeal: [0, 2], cost: [0, 2], ready: [0, 1] } });
  const opp = r.debate.filter(t => t.stance === '반대'), reb = r.debate.filter(t => t.stance === '반론');
  const again = await run({ category: '일상', options: ['A', 'B'], priority: 'cost', facts: { risk: [2, 0], appeal: [0, 2], cost: [0, 2], ready: [0, 1] } });
  ok('J-03 이견: 반대 장관마다 반대 이유 1회 + 판결 쪽 반론 1회, 토론 후에도 표 불변', opp.length >= 1 && reb.length === 1 && JSON.stringify(r.votes) === JSON.stringify(again.votes) && opp.every(t => r.votes[t.speaker] !== r.winner), JSON.stringify(r.debate.map(t => t.speaker + ':' + t.stance))); }
// J-04 날씨 조회 실패 → 근거 없이 판단(점수에 날씨 반영 안 함), 성공 시만 반영
{ const base = { category: '나들이', options: ['한강 피크닉', '실내 카페'], optTags: ['out', 'in'], priority: 'safe', facts: { risk: [0, 0], appeal: [0, 1], cost: [0, 1], ready: [0, 0] } };
  const fail = await run({ ...base, evidence: { items: [{ ok: false }], weather: null } });
  const rain = await run({ ...base, evidence: { items: [], weather: { rain: 80, tmax: 15, tmin: 8, pm10: 20, pm25: 9 } } });
  ok('J-04 날씨 조회 실패 시 출처 없는 정보 사용 안 함(근거 반영 표 이동 0)', fail.moves.length === 0 && fail.scores['신중주의'][0] === 4.5, JSON.stringify(fail.scores['신중주의']));
  ok('J-04b 비 예보(조회 성공)일 때만 신중주의가 야외 점수를 낮추고 다시 판단', rain.scores['신중주의'][0] < 4.5 && rain.moves.some(v => v.name === '신중주의'), JSON.stringify(rain.scores['신중주의']) + JSON.stringify(rain.moves)); }
// J-05 전원 기권/정보 부족 → 판단 보류 + 추가 정보 요청
{ const r = await run({ category: '일상', options: ['A', 'B'], priority: 'safe', facts: { risk: [-1, -1], appeal: [-1, -1], cost: [-1, -1], ready: [-1, -1] } });
  ok('J-05 모두 모름 → 억지 판결 없이 판단 보류 + 정보 요청', r.winner === -1 && r.verdict === '판단 보류!' && Object.values(r.abst).every(a => /모름/.test(a)), r.verdict + JSON.stringify(r.abst));
  const same = await run({ category: '일상', options: ['A', 'B'], priority: 'safe', facts: { risk: [1, 1], appeal: [1, 1], cost: [1, 1], ready: [1, 1] } });
  ok('J-05b 모든 점수가 같으면 차이 없음으로 기권 → 판단 보류', same.winner === -1 && Object.values(same.abst).every(a => /차이가 없음/.test(a)), JSON.stringify(same.abst)); }
// J-06 쇼핑 '살까 말까' 기존 규칙 회귀
{ const r = await p.evaluate(() => {
    const mk = (shop, priority) => ({ ...newMeeting('이어폰 살까'), category: '쇼핑', shopMode: 'single', options: ['구매 승인', '하루 더 생각하기', '보류'], priority, shop: { ...shop, fx: null } });
    return [decide(mk({ priceValue: 50000, budgetValue: 100000, owned: false, use: 'week', need: 'high' }, 'cost')).verdict,
            decide(mk({ priceValue: 150000, budgetValue: 100000, owned: false, use: 'week', need: 'high' }, 'fun')).label,
            decide(mk({ priceValue: 50000, budgetValue: 100000, owned: true, use: 'unknown', need: 'low' }, 'safe')).verdict];
  });
  ok('J-06 살까 말까 기존 규칙 유지(승인 / 예산 초과 총리 직권 / 보류)', r[0] === '구매 승인!' && r[1] === '총리 직권' && r[2] === '보류!', JSON.stringify(r)); }
// J-07 구매 비교: 두 상품의 가격·필요성이 상충 → 장관별 다른 판단, 예산 초과 상품은 직권 제외
{ const r = await p.evaluate(() => {
    const m = { ...newMeeting('이어폰 뭐 살까'), category: '쇼핑', shopMode: 'compare', options: ['비싼 A', '싼 B'], priority: 'fun',
      cmp: { budgetValue: 200000, items: [{ priceValue: 190000 }, { priceValue: 60000 }] }, facts: { ...emptyFacts(), need: [0, 2], use: [0, 2], appeal: [0, 2] } };
    const r1 = decide(m);
    const m2 = { ...m, cmp: { ...m.cmp, budgetValue: 150000 } };
    const r2 = decide(m2);
    const m3 = { ...m, cmp: { ...m.cmp, budgetValue: 50000 } };
    const r3 = decide(m3);
    return { v1: r1.votes, w1: r1.winner, l2: r2.label, w2: r2.winner, v3: r3.verdict, ops: opinionsOf(m, r1).map(o => o.text) };
  });
  ok('J-07 구매 비교: 곰은 싼 B, 쿼카는 끌리는 A — 서로 다른 판단과 이유', r.v1['현실주의'] === 1 && r.v1['낭만주의'] === 0 && r.ops[2].includes('예산의'), JSON.stringify(r.v1));
  ok('J-07b 예산을 넘는 상품은 표가 많아도 총리 직권으로 제외, 전부 넘으면 모두 보류', r.w2 === 1 && r.l2 === '총리 직권' && r.v3 === '모두 보류!', JSON.stringify([r.w2, r.l2, r.v3])); }
// 할까 말까: '안 한다'는 비용 자동 '적음', 행동파는 하는 쪽을 실행 기준으로 평가
{ const r = await run({ category: '일상', title: '운동 갈까', options: ['한다', '안 한다'], yesNo: true, priority: 'easy', facts: { risk: [0, 2], appeal: [2, 0], cost: [0, 2], ready: [0, 2] } });
  ok('Y-01 할까 말까: 행동파는 하지 않는 쪽(2.5점)보다 바로 할 수 있는 「한다」 지지', r.votes['행동파'] === 0 && r.scores['행동파'][1] === 2.5, JSON.stringify(r.votes)); }
// C-01 화면: 쇼핑 '이것 중 뭘 살까?' 비교 모드 전체 흐름
{ await p.click('[data-action="meeting"] >> visible=true'); await p.waitForTimeout(200);
  if (await p.locator('#resume-new').count()) { await p.click('#resume-new'); await p.waitForTimeout(150); }
  await p.locator('.modal [data-cat="쇼핑"]').click(); await p.waitForTimeout(100);
  await p.locator('[data-smode="compare"]').click(); await p.waitForTimeout(100);
  await p.fill('#meeting-title', '이어폰 뭐 살까?');
  await p.locator('.opt-input').nth(0).fill('비싼 A'); await p.locator('.opt-input').nth(1).fill('싼 B');
  await p.locator('#agenda-form button[type="submit"]').click(); await p.waitForTimeout(300);
  await p.fill('#cmp-budget', '200000'); await p.fill('#cmp-price-0', '190000'); await p.fill('#cmp-price-1', '60000');
  await p.locator('#cmp-form button[type="submit"]').click(); await p.waitForTimeout(300);
  const qn = await p.locator('.q-count').innerText();
  for (let k = 0; k < 3; k++) { await p.locator('.modal .choice', { hasText: '비싼 A' }).first().click(); await p.waitForTimeout(150); }
  ok('C-00 구매 비교 질문은 3개(곰은 가격으로 자동 계산)', /1 \/ 3/.test(qn), qn);
  await p.locator('.modal .prio').nth(2).click(); await p.locator('.modal button', { hasText: '표결 시작' }).click(); await p.waitForTimeout(600);
  if (await p.locator('[data-tb]').count()) { await p.locator('[data-tb]').first().click(); await p.waitForTimeout(300); }
  await p.click('#chat-skip'); await p.waitForTimeout(400);
  const t = await p.locator('.modal').innerText();
  ok('C-01 구매 비교 화면 흐름: 상품별 점수표·이견 토론·판결서', t.includes('구매 판결서') && t.includes('예산의') && t.includes('이견 토론') && t.includes('사진·링크 속 정보나 최저가는 확인하지 않았습니다'), t.slice(0, 120));
  const rec = await p.evaluate(() => JSON.parse(localStorage.getItem('decision-country-records'))[0]);
  ok('C-02 기록에 규칙 버전(v2)·비교 모드 저장', rec.rule && rec.rule.rv === 2 && rec.rule.mode === 'compare', JSON.stringify(rec.rule)); }
ok('E-00 페이지 오류 없음', !p.errs.length, p.errs.join(' | '));
console.log(out.join('\n')); console.log(`\n${out.filter(l => l.startsWith('PASS')).length}/${out.length} 통과`);
await b.close();
