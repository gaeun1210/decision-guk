// 결정국 근거 수집 서버 함수 (Vercel Node.js)
// - 외부 API 키는 환경변수(KAKAO_REST_KEY)에만 두고 브라우저로 보내지 않는다.
// - 입력값을 검증하고, 같은 요청은 캐시하며, IP별 호출 횟수를 제한한다.
// - 응답에는 출처(source)와 조회 시각(fetchedAt)을 항상 담는다.

const CACHE = new Map();          // key -> { exp, data } (인스턴스 메모리 캐시)
const HITS = new Map();           // ip -> [timestamps]
const LIMIT = 40, WINDOW = 60_000; // IP당 1분에 40회
const CURRENCIES = ["USD", "JPY", "EUR", "CNY", "GBP", "AUD", "CAD", "HKD", "SGD", "THB"];

function tooMany(ip) {
  const now = Date.now();
  const list = (HITS.get(ip) || []).filter(t => now - t < WINDOW);
  list.push(now); HITS.set(ip, list);
  if (HITS.size > 5000) HITS.clear();
  return list.length > LIMIT;
}
async function cached(key, ttlMs, fn) {
  const hit = CACHE.get(key);
  if (hit && hit.exp > Date.now()) return hit.data;
  const data = { ...(await fn()), fetchedAt: new Date().toISOString() }; // 실제로 외부에서 받아온 시각
  if (data.ok) CACHE.set(key, { exp: Date.now() + ttlMs, data }); // 실패한 결과는 캐시하지 않는다
  if (CACHE.size > 500) CACHE.delete(CACHE.keys().next().value);
  return data;
}
async function getJSON(url, headers = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 5000);
  try {
    const r = await fetch(url, { headers: { "User-Agent": "decision-guk/1.0", ...headers }, signal: ctrl.signal });
    if (!r.ok) throw Object.assign(new Error("upstream " + r.status), { status: r.status });
    return await r.json();
  } finally { clearTimeout(t); }
}
const clean = (v, max) => String(v ?? "").replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, max);
function kstToday() { return new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10); }
function validDate(d) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
  const diff = (Date.parse(d) - Date.parse(kstToday())) / 86400e3;
  return diff >= 0 && diff <= 15;
}

// Open-Meteo 지오코딩은 한글 지명("서울")을 찾지 못하므로, 키 없이도 되도록 주요 국내 지역 좌표를 내장한다.
// 시·군 중심 좌표(날씨 예보용으로 충분한 정밀도).
const KR_PLACES = {
  "서울": [37.5665, 126.9780], "부산": [35.1796, 129.0756], "대구": [35.8714, 128.6014], "인천": [37.4563, 126.7052],
  "광주": [35.1595, 126.8526], "대전": [36.3504, 127.3845], "울산": [35.5384, 129.3114], "세종": [36.4800, 127.2890],
  "경기": [37.2636, 127.0286], "수원": [37.2636, 127.0286], "성남": [37.4201, 127.1265], "용인": [37.2411, 127.1776],
  "고양": [37.6584, 126.8320], "일산": [37.6584, 126.7700], "파주": [37.7600, 126.7800], "가평": [37.8315, 127.5105],
  "양평": [37.4917, 127.4876], "강원": [37.8813, 127.7298], "춘천": [37.8813, 127.7298], "강릉": [37.7519, 128.8761],
  "속초": [38.2070, 128.5918], "양양": [38.0754, 128.6190], "평창": [37.3705, 128.3903], "충북": [36.6424, 127.4890],
  "청주": [36.6424, 127.4890], "단양": [36.9845, 128.3655], "충남": [36.8151, 127.1139], "천안": [36.8151, 127.1139],
  "태안": [36.7456, 126.2979], "공주": [36.4465, 127.1190], "전북": [35.8242, 127.1480], "전주": [35.8242, 127.1480],
  "군산": [35.9676, 126.7366], "전남": [34.8118, 126.3922], "목포": [34.8118, 126.3922], "여수": [34.7604, 127.6622],
  "순천": [34.9506, 127.4872], "경북": [36.0190, 129.3435], "포항": [36.0190, 129.3435], "경주": [35.8562, 129.2247],
  "안동": [36.5684, 128.7294], "경남": [35.2280, 128.6811], "창원": [35.2280, 128.6811], "통영": [34.8544, 128.4331],
  "거제": [34.8806, 128.6211], "남해": [34.8376, 127.8924], "진주": [35.1800, 128.1076], "제주": [33.4996, 126.5312],
  "서귀포": [33.2541, 126.5600], "울릉": [37.4844, 130.9058]
};
function lookupKorean(place) {
  const p = place.replace(/\s/g, "");
  let best = null;
  for (const name of Object.keys(KR_PLACES)) {
    if (p.includes(name) && (!best || name.length > best.length)) best = name; // 더 긴 이름 우선("서귀포" > "제주")
  }
  if (!best) return null;
  const [lat, lon] = KR_PLACES[best];
  return { name: best, lat, lon, via: "결정국 내장 지역표" };
}

// 입력에 들어 있는 시·도/시·군 이름(예: "대구 동성로" → ["대구"])
const PROVINCE_ALIASES = { "경상북도": "경북", "경상남도": "경남", "전라북도": "전북", "전라남도": "전남", "충청북도": "충북", "충청남도": "충남", "강원도": "강원", "경기도": "경기", "제주도": "제주" };
function regionWords(place) {
  let p = place.replace(/\s/g, "");
  for (const [full, short] of Object.entries(PROVINCE_ALIASES)) p = p.replace(full, short);
  return Object.keys(KR_PLACES).filter(name => p.includes(name));
}
const areaOf = d => (d.address_name || d.road_address_name || "").split(" ").slice(0, 2).join(" "); // "대구 중구"
const labelOf = d => (d.place_name || "").startsWith(areaOf(d)) ? d.place_name : `${d.place_name} (${areaOf(d)})`;

// Kakao로 사용자가 적은 '지역'을 찾는다(주소 검색 → 장소 검색). 전국에서 가장 비슷한 이름 하나를 고르면
// "동성로" → 부산의 '○○ 동성로점'처럼 엉뚱한 도시가 잡히므로, 다음 규칙을 따른다.
//  1) 입력에 도시 이름이 있으면 그 도시 주소의 결과만 쓴다.
//  2) 도시 이름이 없고 상위 결과가 여러 시·도에 흩어져 있으면, 추측하지 않고 도시 이름을 붙여 달라고 안내한다.
async function kakaoLocate(place, key) {
  const H = { Authorization: `KakaoAK ${key}` };
  const words = regionWords(place);
  const pick = docs => {
    docs = docs.filter(d => d.x && d.y);
    if (!docs.length) return null;
    if (words.length) {
      const hit = docs.find(d => words.some(w => `${d.address_name || ""} ${d.road_address_name || ""}`.includes(w)));
      return hit ? { doc: hit } : null; // 그 도시 결과가 없으면 버린다(내장 지역표로)
    }
    const counts = {};
    for (const d of docs) { const pr = (d.address_name || "").split(" ")[0]; if (pr) counts[pr] = (counts[pr] || 0) + 1; }
    const provinces = Object.keys(counts).sort((a, b) => counts[b] - counts[a]); // 많이 나온 지역부터
    if (provinces.length > 1) {
      return { ambiguous: `"${place}"이(가) 여러 지역에 있어요(${provinces.slice(0, 4).join("·")} 등). 앞에 도시 이름을 붙여 주세요. 예) 대구 동성로, 서울 강남역` };
    }
    return { doc: docs[0] };
  };
  // ① 주소 검색: "동성로", "수성구"처럼 길·동네 이름은 주소로 찾는 것이 정확하다
  const a = await getJSON(`https://dapi.kakao.com/v2/local/search/address.json?size=10&query=${encodeURIComponent(place)}`, H);
  const byAddress = pick((a.documents || []).map(d => ({ ...d, place_name: d.address_name })));
  if (byAddress) return byAddress;
  // ② 키워드 검색: "강남역", "경포대"처럼 장소 이름
  const k = await getJSON(`https://dapi.kakao.com/v2/local/search/keyword.json?size=15&query=${encodeURIComponent(place)}`, H);
  return pick(k.documents || []);
}

// 지역 이름 → 좌표: Kakao(키가 있을 때) → 내장 지역표 → Open-Meteo 지오코딩(영문 지명 등) 순서
async function geocode(place) {
  const key = process.env.KAKAO_REST_KEY;
  if (key) {
    try {
      const r = await kakaoLocate(place, key);
      if (r && r.ambiguous) {
        const local = lookupKorean(place);
        if (!local) return { ambiguous: r.ambiguous };
      } else if (r && r.doc) {
        return { name: labelOf(r.doc), lat: +r.doc.y, lon: +r.doc.x, via: "Kakao Local" };
      }
    } catch { /* Kakao 키 오류·장애 시 내장 지역표로 넘어간다 */ }
  }
  const local = lookupKorean(place);
  if (local) return local;
  const j = await getJSON(`https://geocoding-api.open-meteo.com/v1/search?count=1&language=ko&name=${encodeURIComponent(place)}`);
  const d = j.results && j.results[0];
  if (!d) return null;
  return { name: [d.name, d.admin1].filter(Boolean).join(", "), lat: d.latitude, lon: d.longitude, via: "Open-Meteo Geocoding" };
}

async function weather(place, date) {
  const g = await geocode(place);
  if (!g) return { ok: false, reason: "지역을 찾지 못했어요" };
  if (g.ambiguous) return { ok: false, reason: g.ambiguous };
  const q = `latitude=${g.lat}&longitude=${g.lon}&timezone=Asia%2FSeoul&start_date=${date}&end_date=${date}`;
  const f = await getJSON(`https://api.open-meteo.com/v1/forecast?${q}&daily=weather_code,precipitation_probability_max,temperature_2m_max,temperature_2m_min,uv_index_max,sunset`);
  const d = f.daily || {};
  let pm10 = null, pm25 = null;
  try {
    const a = await getJSON(`https://air-quality-api.open-meteo.com/v1/air-quality?${q}&hourly=pm10,pm2_5`);
    const hours = (a.hourly && a.hourly.time || []).map((t, i) => [Number(t.slice(11, 13)), a.hourly.pm10[i], a.hourly.pm2_5[i]])
      .filter(([h, p]) => h >= 9 && h <= 21 && p != null);
    if (hours.length) {
      pm10 = Math.round(hours.reduce((s, x) => s + x[1], 0) / hours.length);
      pm25 = Math.round(hours.reduce((s, x) => s + x[2], 0) / hours.length);
    }
  } catch { /* 미세먼지는 없어도 날씨만으로 진행 */ }
  return {
    ok: true, place: g.name, date,
    rain: d.precipitation_probability_max ? d.precipitation_probability_max[0] : null,
    tmax: d.temperature_2m_max ? d.temperature_2m_max[0] : null,
    tmin: d.temperature_2m_min ? d.temperature_2m_min[0] : null,
    uv: d.uv_index_max ? d.uv_index_max[0] : null,
    code: d.weather_code ? d.weather_code[0] : null,
    sunset: d.sunset ? String(d.sunset[0]).slice(11, 16) : null,
    pm10, pm25,
    source: `Open-Meteo 예보${pm10 != null ? "·대기질(모델 예측값)" : ""} / 위치: ${g.via}`
  };
}

async function holiday(date) {
  const year = date.slice(0, 4);
  const list = await getJSON(`https://date.nager.at/api/v3/PublicHolidays/${year}/KR`);
  const names = new Map(list.map(h => [h.date, h.localName || h.name]));
  const off = d => { const w = new Date(d + "T00:00:00Z").getUTCDay(); return w === 0 || w === 6 || names.has(d); };
  const shift = (d, n) => new Date(Date.parse(d) + n * 86400e3).toISOString().slice(0, 10);
  let run = 0;
  if (off(date)) { run = 1; for (let i = 1; off(shift(date, -i)) && i < 10; i++) run++; for (let i = 1; off(shift(date, i)) && i < 10; i++) run++; }
  return { ok: true, date, holiday: names.get(date) || null, offDays: run, longWeekend: run >= 3, source: "Nager.Date 공휴일" };
}

async function fx(from) {
  let j;
  try { j = await getJSON(`https://api.frankfurter.dev/v1/latest?base=${from}&symbols=KRW`); }
  catch { j = await getJSON(`https://api.frankfurter.app/latest?from=${from}&to=KRW`); }
  const rate = j.rates && j.rates.KRW;
  if (!rate) return { ok: false, reason: "환율을 찾지 못했어요" };
  return { ok: true, from, rate, rateDate: j.date, source: "Frankfurter (유럽중앙은행 기준환율)" };
}

async function places(near, names) {
  const key = process.env.KAKAO_REST_KEY;
  if (!key) return { ok: false, reason: "장소 검색이 아직 설정되지 않았어요" };
  const H = { Authorization: `KakaoAK ${key}` };
  const loc = await kakaoLocate(near, key);
  if (loc && loc.ambiguous) return { ok: false, reason: loc.ambiguous };
  const c = loc && loc.doc;
  if (!c) return { ok: false, reason: "출발지를 찾지 못했어요" };
  const out = [];
  for (const n of names) {
    const j = await getJSON(`https://dapi.kakao.com/v2/local/search/keyword.json?size=1&radius=20000&sort=accuracy&x=${c.x}&y=${c.y}&query=${encodeURIComponent(n)}`, H);
    const d = j.documents && j.documents[0];
    out.push(d ? { option: n, name: d.place_name, address: d.road_address_name || d.address_name, distance: Number(d.distance) || null, category: d.category_name, url: d.place_url } : { option: n, name: null });
  }
  return { ok: true, near: labelOf(c), places: out, source: "Kakao Local 장소 검색" };
}

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (req.method !== "GET") { res.statusCode = 405; return res.end(JSON.stringify({ ok: false, reason: "GET만 허용" })); }
  const ip = String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "?").split(",")[0].trim();
  if (tooMany(ip)) { res.statusCode = 429; return res.end(JSON.stringify({ ok: false, reason: "요청이 너무 많아요. 잠시 후 다시 시도해 주세요." })); }
  const u = new URL(req.url, "http://x");
  const type = u.searchParams.get("type");
  try {
    let data, ttl;
    if (type === "weather") {
      const place = clean(u.searchParams.get("place"), 30), date = clean(u.searchParams.get("date"), 10);
      if (!place || !validDate(date)) { res.statusCode = 400; return res.end(JSON.stringify({ ok: false, reason: "지역과 오늘부터 15일 이내 날짜가 필요해요" })); }
      ttl = 30 * 60e3; data = await cached(`w|${place}|${date}`, ttl, () => weather(place, date));
    } else if (type === "holiday") {
      const date = clean(u.searchParams.get("date"), 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { res.statusCode = 400; return res.end(JSON.stringify({ ok: false, reason: "날짜 형식 오류" })); }
      ttl = 24 * 3600e3; data = await cached(`h|${date}`, ttl, () => holiday(date));
    } else if (type === "fx") {
      const from = clean(u.searchParams.get("from"), 3).toUpperCase();
      if (!CURRENCIES.includes(from)) { res.statusCode = 400; return res.end(JSON.stringify({ ok: false, reason: "지원하지 않는 통화" })); }
      ttl = 6 * 3600e3; data = await cached(`f|${from}`, ttl, () => fx(from));
    } else if (type === "places") {
      const near = clean(u.searchParams.get("near"), 30);
      const names = u.searchParams.getAll("q").map(q => clean(q, 40)).filter(Boolean).slice(0, 6);
      if (!near || names.length < 1) { res.statusCode = 400; return res.end(JSON.stringify({ ok: false, reason: "출발지와 장소 이름이 필요해요" })); }
      ttl = 6 * 3600e3; data = await cached(`p|${near}|${names.join("|")}`, ttl, () => places(near, names));
    } else { res.statusCode = 400; return res.end(JSON.stringify({ ok: false, reason: "알 수 없는 요청" })); }
    res.setHeader("Cache-Control", data.ok ? `public, max-age=0, s-maxage=${Math.round(ttl / 1000)}` : "no-store");
    res.end(JSON.stringify(data));
  } catch (e) {
    res.statusCode = 502;
    res.end(JSON.stringify({ ok: false, reason: e.name === "AbortError" ? "외부 정보 서버가 응답하지 않아요" : "외부 정보를 가져오지 못했어요" }));
  }
};
