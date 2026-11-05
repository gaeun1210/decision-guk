"use strict";
const STORAGE_KEY = "decision-country-records";

// 장관 정보: 질문 하나씩을 맡고, 사용자의 답이 그 장관의 표가 된다(규칙 공개, AI 미사용). 순서는 첫 화면 배치(토끼·쿼카·곰·병아리)와 같다.
const MINISTERS = [
  { name: "신중주의", priority: "safe", img: "rabbit_desk", face: "face_rabbit", stand: "stand_rabbit", emoji: "🐰", animal: "토끼", question: "어느 쪽이 나중에 후회가 가장 적을 것 같나요?" },
  { name: "낭만주의", priority: "fun",  img: "quokka_desk", face: "face_quokka", stand: "stand_quokka", emoji: "🐹", animal: "쿼카", question: "솔직히 어느 쪽이 가장 끌리나요?" },
  { name: "현실주의", priority: "cost", img: "bear_desk", face: "face_bear", stand: "stand_bear",   emoji: "🐻", animal: "곰",   question: "어느 쪽이 돈과 시간이 가장 덜 드나요?" },
  { name: "행동파",   priority: "easy", img: "chick_desk", face: "face_chick", stand: "stand_chick",  emoji: "🐤", animal: "병아리", question: "어느 쪽을 지금 바로 시작할 수 있나요?" }
];
const LIMITS = { title: 100, detail: 1000, option: 40, optionsMax: 6, moneyMin: 1, moneyMax: 100000000 };
const PRIORITY_LABEL = { cost: "비용·시간", fun: "즐거움", safe: "후회 없음", easy: "실행 쉬움" };

const CATEGORIES = ["나들이", "맛집", "쇼핑", "일상"];
// 예전 유형(여행·연애·게임) 기록은 그대로 보여 주고, 다시 회의할 때는 새 유형으로 옮긴다.
const LEGACY_CATEGORY = { 여행: "나들이", 연애: "일상", 게임: "일상" };
const currentCategory = c => CATEGORIES.includes(c) ? c : (LEGACY_CATEGORY[c] || "일상");
let selectedCategory = "일상";
const modalRoot = document.getElementById("modal-root");

function getRecords() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return Array.isArray(saved) ? saved : [];
  } catch { return []; }
}
function saveRecords(records) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(records.slice(0, 100))); return true; }
  catch { return false; }
}

// ===== 로그인·서버 저장 (Supabase) =====
// 공개(publishable) 키만 둔다. 이 키로는 RLS 규칙이 허용한 일(로그인한 사람의 "자기 기록" 조회·추가·삭제)만 할 수 있다.
// service_role/secret 키는 RLS를 건너뛰므로 절대 이 파일이나 저장소에 넣지 않는다.
const SUPABASE_URL = "https://acujnijqjbwblqtuxatj.supabase.co";
const SUPABASE_KEY = "sb_publishable_UxzsgGhTjOXjL8zlI9v5Nw_vtfGi5jO";
const db = window.supabase && window.supabase.createClient
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } })
  : null;
let currentUser = null;
let profileAvatar = "";

function dbDate(iso) {
  const d = new Date(iso);
  return isNaN(d) ? "" : `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
}
function fromRow(row) {
  return {
    id: row.id, title: row.title, verdict: row.verdict, category: row.category,
    date: dbDate(row.created_at), icon: categoryIcon(row.category), detail: row.detail,
    tally: row.tally, label: row.label, retrial: row.retrial, priority: row.priority,
    options: Array.isArray(row.options) ? row.options.map(String) : [],
    evidence: row.evidence && Array.isArray(row.evidence.items) ? row.evidence.items.slice(0, 6).map(e => ({ label: String(e.label || ""), ok: !!e.ok, summary: String(e.summary || ""), source: String(e.source || ""), fetchedAt: e.fetchedAt || null })) : [],
    moves: row.evidence && Array.isArray(row.evidence.moves) ? row.evidence.moves.slice(0, 4).map(v => ({ name: String(v.name || ""), from: String(v.from || ""), to: String(v.to || "") })) : [],
    opinions: Array.isArray(row.opinions) ? row.opinions.filter(o => Array.isArray(o) && o.length === 2).map(([n, t]) => [String(n), String(t)]) : []
  };
}

// 기록 불러오기: 로그인 → 서버(RLS로 내 것만), 비로그인 → 이 브라우저(체험 모드)
async function loadRecords() {
  if (!currentUser) return { records: getRecords(), source: "local" };
  const cols = "id,title,category,detail,options,priority,verdict,label,tally,opinions,retrial,created_at";
  let { data, error } = await db.from("decisions").select(cols + ",evidence").order("created_at", { ascending: false }).limit(100);
  if (error && /evidence/.test(String(error.message))) ({ data, error } = await db.from("decisions").select(cols).order("created_at", { ascending: false }).limit(100));
  if (error) return { records: [], source: "server", error };
  return { records: data.map(fromRow), source: "server" };
}

async function addRecord(record, m) {
  if (!currentUser) {
    const list = getRecords(); list.unshift(record);
    return { ok: saveRecords(list), source: "local" };
  }
  const shop = m.category === "쇼핑";
  const row = {
    title: record.title, category: record.category, detail: record.detail || "",
    options: m.options, priority: m.priority,
    price: shop ? m.shop.priceValue : null, budget: shop ? m.shop.budgetValue : null,
    verdict: record.verdict, label: record.label, tally: record.tally,
    opinions: record.opinions, retrial: !!record.retrial, evidence: { items: record.evidence || [], moves: record.moves || [] }
  }; // user_id는 DB가 auth.uid()로 채운다(화면에서 보내지 않음)
  let { error } = await db.from("decisions").insert(row);
  if (error && /evidence/.test(String(error.message))) { delete row.evidence; ({ error } = await db.from("decisions").insert(row)); } // 근거 칸이 아직 없는 DB
  return { ok: !error, source: "server", error };
}

async function removeRecord(item, index) {
  if (!currentUser) {
    const list = getRecords(); list.splice(index, 1);
    return { ok: saveRecords(list) };
  }
  const { error } = await db.from("decisions").delete().eq("id", item.id);
  return { ok: !error, error };
}

async function clearRecords() {
  if (!currentUser) { try { localStorage.removeItem(STORAGE_KEY); } catch {} return { ok: true }; }
  const { error } = await db.from("decisions").delete().eq("user_id", currentUser.id);
  return { ok: !error, error };
}

function authMessage(error) {
  const msg = String(error && (error.message || error.code) || "");
  if (/invalid login credentials/i.test(msg)) return "이메일 또는 비밀번호가 맞지 않아요.";
  if (/email not confirmed/i.test(msg)) return "이메일 인증을 먼저 완료해 주세요. 받은 메일함(스팸함 포함)을 확인해 주세요.";
  if (/rate limit|too many/i.test(msg)) return "요청이 너무 많아요. 잠시 후 다시 시도해 주세요.";
  if (/password/i.test(msg)) return "비밀번호 조건을 확인해 주세요(8자 이상, 영문과 숫자를 섞어 주세요).";
  if (/already registered|already exists/i.test(msg)) return "이미 가입된 이메일이에요. 로그인해 주세요.";
  if (/fetch|network/i.test(msg)) return "서버에 연결하지 못했어요. 인터넷 연결을 확인해 주세요.";
  return "처리하지 못했어요. 잠시 후 다시 시도해 주세요.";
}
function dbMessage(error) {
  if (!error) return "";
  if (/jwt|auth|permission|policy|42501/i.test(String(error.message || error.code))) return "권한이 없어 처리하지 못했어요. 다시 로그인해 주세요.";
  if (/check|23514|violates/i.test(String(error.message || error.code))) return "입력값이 허용 범위를 벗어나 저장하지 않았어요.";
  return "서버에 저장하지 못했어요. 잠시 후 다시 시도해 주세요.";
}

async function loadProfile() {
  profileAvatar = "";
  if (!currentUser) return;
  const { data } = await db.from("profiles").select("avatar").eq("user_id", currentUser.id).maybeSingle();
  if (data && AVATARS.some(a => a[0] === data.avatar)) profileAvatar = data.avatar;
}
async function setAvatar(id) {
  if (!currentUser) { try { localStorage.setItem(AVATAR_KEY, id); } catch {} return { ok: true }; }
  const { error } = await db.from("profiles").upsert({ user_id: currentUser.id, avatar: id, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
  if (!error) profileAvatar = id;
  return { ok: !error, error };
}

async function onAuthChanged(session) {
  currentUser = session && session.user ? session.user : null;
  await loadProfile();
  applyAvatar();
  showRecent();
}

function openLogin(mode = "login", notice = "") {
  if (!db) {
    openModal("👤 로그인", `<p class="err">로그인 서버에 연결하지 못했어요(네트워크 또는 차단 문제). 지금은 체험 모드로 이 브라우저에만 저장됩니다.</p>`);
    return;
  }
  const signup = mode === "signup";
  openModal("👤 " + (signup ? "회원가입" : "로그인"), `
    <div class="chip-row tabs" role="tablist">
      <button type="button" class="chip" role="tab" data-mode="login" aria-pressed="${!signup}">로그인</button>
      <button type="button" class="chip" role="tab" data-mode="signup" aria-pressed="${signup}">회원가입</button>
    </div>
    <form id="auth-form" novalidate>
      <div class="field"><label for="auth-email">이메일</label>
        <input id="auth-email" type="email" autocomplete="email" maxlength="254" required /></div>
      <div class="field"><label for="auth-pw">비밀번호</label>
        <input id="auth-pw" type="password" autocomplete="${signup ? "new-password" : "current-password"}" minlength="8" maxlength="72" required />
        ${signup ? `<div class="hint">8자 이상, 영문과 숫자를 섞어 주세요.</div>` : ""}</div>
      <p class="err" id="auth-err" role="alert" hidden></p>
      <p class="ok" id="auth-ok" role="status" ${notice ? "" : "hidden"}>${escapeHTML(notice)}</p>
      ${signup ? `<p class="hint">가입하면 <a href="privacy.html" target="_blank" rel="noopener">개인정보 처리 안내</a>에 동의한 것으로 봅니다. 수집 항목은 이메일과 결정 기록뿐이에요.</p>` : ""}
      <button class="primary" type="submit" id="auth-submit">${signup ? "가입하기" : "로그인"}</button>
      ${signup ? "" : `<p class="center"><button type="button" class="link-btn" id="forgot-btn">비밀번호를 잊으셨나요?</button></p>`}
    </form>
    <p class="hint">로그인하면 결정 기록이 계정에 저장되어 다른 기기에서도 볼 수 있고, 다른 사람은 내 기록을 볼 수 없습니다. 비밀번호는 인증 서버(Supabase)가 보관하며 결정국 화면 코드는 비밀번호를 저장하지 않습니다.</p>`, () => {
      modalRoot.querySelectorAll("[data-mode]").forEach(b => b.onclick = () => openLogin(b.dataset.mode));
      const forgot = document.getElementById("forgot-btn"); if (forgot) forgot.onclick = openReset;
      document.getElementById("auth-email").focus();
      document.getElementById("auth-form").onsubmit = async event => {
        event.preventDefault();
        const email = document.getElementById("auth-email").value.trim();
        const password = document.getElementById("auth-pw").value;
        showError("auth-err", "");
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return showError("auth-err", "이메일 형식을 확인해 주세요.");
        if (password.length < 8) return showError("auth-err", "비밀번호는 8자 이상이어야 해요.");
        if (signup && !(/[A-Za-z]/.test(password) && /\d/.test(password))) return showError("auth-err", "비밀번호에 영문과 숫자를 함께 넣어 주세요.");
        const btn = document.getElementById("auth-submit"); btn.disabled = true; btn.textContent = "처리 중…";
        try {
          if (signup) {
            const { data, error } = await db.auth.signUp({ email, password, options: { emailRedirectTo: location.origin + location.pathname } });
            if (error) throw error;
            if (data.session) { closeModal(); return; }
            openLogin("login", "가입 확인 메일을 보냈어요. 메일의 링크를 누른 뒤 로그인해 주세요.");
          } else {
            const { error } = await db.auth.signInWithPassword({ email, password });
            if (error) throw error;
            closeModal();
          }
        } catch (error) {
          showError("auth-err", authMessage(error));
          btn.disabled = false; btn.textContent = signup ? "가입하기" : "로그인";
        }
      };
    });
}

function openAccount() {
  openModal("👤 내 계정", `
    <p>로그인한 계정: <b>${escapeHTML(currentUser.email || "")}</b></p>
    <p class="hint">결정 기록은 이 계정에만 저장되며, 행 단위 접근 제어(RLS)로 다른 사람은 볼 수도 지울 수도 없습니다.</p>
    <p class="err" id="acct-err" role="alert" hidden></p>
    <div class="btn-row">
      <button class="primary secondary" id="logout-btn">로그아웃</button>
      <button class="primary secondary" id="pw-btn">비밀번호 변경</button>
    </div>
    <p class="center"><button type="button" class="link-btn danger-link" id="del-btn">회원 탈퇴</button> · <a href="privacy.html" target="_blank" rel="noopener">개인정보 처리 안내</a></p>`, () => {
      document.getElementById("pw-btn").onclick = openNewPassword;
      document.getElementById("del-btn").onclick = openDeleteAccount;
      document.getElementById("logout-btn").onclick = async () => {
        const { error } = await db.auth.signOut();
        if (error) return showError("acct-err", authMessage(error));
        closeModal();
      };
    });
}


function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);
}
// 금액 검증: 원 단위 정수 1~100,000,000만 허용하고, 그 밖의 값은 보정하지 않고 거부한다.
function parseMoney(raw) {
  const text = String(raw ?? "").replace(/[,\s]/g, "");
  if (!text) return { error: "금액을 입력해 주세요." };
  if (/^-/.test(text)) return { error: "음수는 입력할 수 없어요." };
  if (!/^\d+$/.test(text)) return { error: "숫자(원 단위 정수)만 입력해 주세요." };
  const n = Number(text);
  if (n < LIMITS.moneyMin) return { error: "1원 이상으로 입력해 주세요." };
  if (n > LIMITS.moneyMax) return { error: "1억 원(100,000,000원) 이하로 입력해 주세요." };
  return { value: n };
}
// 해외 가격: 소수 둘째 자리까지, 0보다 크고 100만 이하
function parseForeign(raw) {
  const text = String(raw ?? "").replace(/[,\s]/g, "");
  if (!text) return { error: "금액을 입력해 주세요." };
  if (/^-/.test(text)) return { error: "음수는 입력할 수 없어요." };
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return { error: "숫자(소수 둘째 자리까지)만 입력해 주세요." };
  const n = Number(text);
  if (n <= 0) return { error: "0보다 큰 금액을 입력해 주세요." };
  if (n > 1000000) return { error: "너무 큰 금액이에요." };
  return { value: n };
}
function today() {
  const d = new Date();
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
}
function categoryIcon(category) {
  return ({ 나들이: "✈️", 여행: "✈️", 맛집: "🍴", 쇼핑: "🛍️", 연애: "❤️", 게임: "🎮" })[category] || "📌";
}
function avatar(minister) {
  return minister.img
    ? `<img class="avatar" src="assets/${minister.img}.png" alt="" />`
    : `<span class="avatar emoji">${minister.emoji}</span>`;
}

async function showRecent() {
  const list = document.getElementById("recent-list"), note = document.getElementById("recent-note");
  if (!list.children.length) list.innerHTML = `<div class="record-row"><span class="record-title record-empty">불러오는 중…</span></div>`;
  const { records, error } = await loadRecords();
  note.textContent = currentUser ? "🔒 내 계정" : "🧪 체험 모드";
  if (!records.length) {
    list.innerHTML = `<div class="record-row"><span class="record-title record-empty">${error ? "기록을 불러오지 못했어요." : "아직 기록이 없어요. 옆의 예시를 누르거나 고민을 접수해 보세요!"}</span></div>`;
    return;
  }
  list.innerHTML = records.slice(0, 3).map((item, i) => `
    <button type="button" class="record-row as-btn" data-recent="${i}">
      <span class="record-icon">${escapeHTML(item.icon || "📌")}</span>
      <span class="record-title" title="${escapeHTML(item.title)}">${escapeHTML(item.title)}</span>
      <span class="verdict-pill">${escapeHTML(item.verdict)}</span>
      <span class="record-date">${escapeHTML(item.date || "")}</span>
    </button>`).join("");
  list.querySelectorAll("[data-recent]").forEach(b => b.onclick = showRecords);
}

function openModal(title, body, onReady) {
  modalRoot.innerHTML = `
    <div class="modal-backdrop" role="presentation">
      <section class="modal" role="dialog" aria-modal="true" aria-label="${escapeHTML(title)}">
        <div class="modal-head">
          <h2>${escapeHTML(title)}</h2>
          <button class="close" aria-label="닫기">×</button>
        </div>
        <div class="modal-body">${body}</div>
      </section>
    </div>`;
  modalRoot.querySelector(".close").onclick = closeModal;
  modalRoot.querySelector(".modal-backdrop").addEventListener("click", event => {
    if (event.target.classList.contains("modal-backdrop")) closeModal();
  });
  if (onReady) onReady();
}
function closeModal() { modalRoot.innerHTML = ""; }
document.addEventListener("keydown", event => { if (event.key === "Escape") closeModal(); });

// ===== 국무회의: 안건 → 장관 질문(또는 구매 질문) → 가장 중요한 기준 → (동점이면 총리 질문) → 결재 =====
let meeting = null;

function newMeeting(prefill) {
  return {
    title: prefill || "", category: selectedCategory, detail: "",
    rawOptions: ["", ""], options: [], yesNo: false, rawTags: [null, null], optTags: [], activityTag: null,
    place: "", date: kstToday(), weatherOn: false, evidence: null,
    answers: {}, qIndex: 0,
    shop: { price: "", budget: "", owned: null, use: null, need: null, currency: "KRW", fx: null },
    priority: null, reversible: null, urgent: null, tiebreak: null, retrial: false
  };
}

function startMeeting(prefill = "") {
  meeting = newMeeting(prefill);
  renderAgenda();
}

function stepBar(active) {
  const shop = meeting.category === "쇼핑";
  const names = ["안건 접수", shop ? "구매 심사" : "장관 질문", "중요 기준", "결재"];
  return `<ol class="steps" aria-label="진행 단계">${names.map((n, i) =>
    `<li class="${i < active ? "done" : i === active ? "now" : ""}" ${i === active ? 'aria-current="step"' : ""}>${n}</li>`).join("")}</ol>`;
}

function showError(id, message) {
  const box = document.getElementById(id);
  if (box) { box.textContent = message; box.hidden = !message; }
}

function normalize(text) { return text.replace(/\s+/g, "").toLowerCase(); }

// ① 안건 접수
function renderAgenda() {
  const m = meeting;
  const shop = m.category === "쇼핑";
  openModal("🏛️ 국무회의", `
    ${stepBar(0)}
    <form id="agenda-form" novalidate>
      <div class="field">
        <label for="meeting-title">고민 제목</label>
        <input id="meeting-title" maxlength="${LIMITS.title}" value="${escapeHTML(m.title)}" placeholder="예) 오늘 저녁 뭐 먹지?" autocomplete="off" />
      </div>
      <div class="field">
        <span class="label">고민 유형</span>
        <div class="chip-row" role="group" aria-label="고민 유형">
          ${CATEGORIES.map(c => `<button type="button" class="chip" data-cat="${c}" aria-pressed="${c === m.category}">${categoryIcon(c)} ${c}</button>`).join("")}
        </div>
      </div>
      ${WEATHER_CATS.includes(m.category) ? `
      <div class="field-row ctx-row">
        <div class="field"><label for="meeting-place">${m.category === "맛집" ? "📍 출발 동네" : "📍 지역"} <small>(선택)</small></label>
          <input id="meeting-place" maxlength="30" autocomplete="off" value="${escapeHTML(m.place)}" placeholder="${m.category === "맛집" ? "예) 대구 동성로" : "예) 강릉, 대구 수성구"}" /></div>
        <div class="field"><label for="meeting-date">📅 날짜</label>
          <input id="meeting-date" type="date" min="${kstToday()}" max="${addDays(kstToday(), 15)}" value="${escapeHTML(m.date)}" /></div>
      </div>
      <div class="hint">${m.category === "맛집" ? "출발 동네를 도시 이름부터 적으면(예: 대구 동성로) 선택지(가게 이름·메뉴)를 근처에서 찾아 거리를 비교하고, 날씨도 반영해요." : "지역을 도시 이름부터 적으면 그날의 날씨·미세먼지·공휴일을 조회해 장관 판단에 반영해요."}</div>` : `<div class="hint">📌 일상 고민은 외부 정보 없이 입력한 답만으로 판단해요. 장소·날짜가 있는 고민이면 ✈️ 나들이를 고르면 날씨를 반영해요.</div>`}
      ${shop ? `
      <div class="info-box">🛍️ <b>구매 재판</b>으로 진행합니다. 다음 단계에서 가격·예산과 필요성을 물어볼게요.</div>` : `
      <div class="field">
        <span class="label">선택지 <small>(최대 ${LIMITS.optionsMax}개)</small></span>
        <div id="option-list">
          ${m.rawOptions.map((o, i) => `
            <div class="opt-row">
              <span class="opt-no">${i + 1}</span>
              <input class="opt-input" maxlength="${LIMITS.option}" value="${escapeHTML(o)}" placeholder="${i === 0 ? "예) 마라탕" : i === 1 ? "예) 탕수육" : "선택지"}" aria-label="선택지 ${i + 1}" autocomplete="off" />
              ${TAG_CATS.includes(m.category) ? `<span class="tag-pick" role="group" aria-label="선택지 ${i + 1} 장소">
                <button type="button" class="tag" data-tag="${i}" data-v="in" aria-pressed="${m.rawTags[i] === "in"}" title="실내">🏠</button>
                <button type="button" class="tag" data-tag="${i}" data-v="out" aria-pressed="${m.rawTags[i] === "out"}" title="야외">🌳</button></span>` : ""}
              ${m.rawOptions.length > 2 ? `<button type="button" class="opt-del" data-del="${i}" aria-label="선택지 ${i + 1} 삭제">✕</button>` : ""}
            </div>`).join("")}
        </div>
        ${m.rawOptions.length < LIMITS.optionsMax ? `<button type="button" class="add-opt" id="add-opt">＋ 선택지 추가</button>` : ""}
        <div class="hint">선택지를 하나만 적거나 비워 두면 「한다 / 안 한다」로 회의합니다.${TAG_CATS.includes(m.category) ? " 🏠실내 / 🌳야외를 표시하면 날씨가 판단에 반영돼요." : ""}</div>
        ${TAG_CATS.includes(m.category) && m.rawOptions.every(o => !o.trim()) ? `<div class="chip-row slim-row"><span class="hint">할까 말까 고민이라면, 이 활동은</span>
          <button type="button" class="chip" data-act="in" aria-pressed="${m.activityTag === "in"}">🏠 실내</button><button type="button" class="chip" data-act="out" aria-pressed="${m.activityTag === "out"}">🌳 야외</button></div>` : ""}
      </div>`}
      <details class="field more" ${m.detail ? "open" : ""}>
        <summary>고민 내용 더 적기 (선택)</summary>
        <textarea id="meeting-detail" maxlength="${LIMITS.detail}" placeholder="상황이나 마음에 걸리는 점을 적어 주세요.">${escapeHTML(m.detail)}</textarea>
      </details>
      <p class="err" id="agenda-err" role="alert" hidden></p>
      <div class="notice">일상 선택을 돕는 놀이용 서비스입니다. 법률·금융·의료 등 전문 판단이나 위기 상황을 대신하지 않습니다.</div>
      <button class="primary" type="submit">다음 ▶</button>
    </form>`, () => {
      const keep = () => {
        m.title = document.getElementById("meeting-title").value;
        m.detail = document.getElementById("meeting-detail").value;
        document.querySelectorAll(".opt-input").forEach((el, i) => { m.rawOptions[i] = el.value; });
        const pl = document.getElementById("meeting-place"), dt = document.getElementById("meeting-date"), wo = document.getElementById("meeting-weather");
        if (pl) m.place = pl.value; if (dt) m.date = dt.value || kstToday(); if (wo) m.weatherOn = wo.checked;
      };
      modalRoot.querySelectorAll("[data-tag]").forEach(b => b.onclick = () => { keep(); const i = Number(b.dataset.tag); m.rawTags[i] = m.rawTags[i] === b.dataset.v ? null : b.dataset.v; renderAgenda(); });
      modalRoot.querySelectorAll("[data-act]").forEach(b => b.onclick = () => { keep(); m.activityTag = m.activityTag === b.dataset.act ? null : b.dataset.act; renderAgenda(); });
      modalRoot.querySelectorAll("[data-cat]").forEach(b => b.onclick = () => { keep(); m.category = b.dataset.cat; renderAgenda(); });
      const add = document.getElementById("add-opt");
      if (add) add.onclick = () => { keep(); m.rawOptions.push(""); m.rawTags.push(null); renderAgenda(); modalRoot.querySelectorAll(".opt-input")[m.rawOptions.length - 1].focus(); };
      modalRoot.querySelectorAll("[data-del]").forEach(b => b.onclick = () => { keep(); m.rawOptions.splice(Number(b.dataset.del), 1); m.rawTags.splice(Number(b.dataset.del), 1); renderAgenda(); });
      document.getElementById("meeting-title").focus();
      document.getElementById("agenda-form").onsubmit = event => {
        event.preventDefault();
        keep();
        const title = m.title.trim();
        if (!title) return showError("agenda-err", "고민 제목을 적어 주세요.");
        if (title.length > LIMITS.title) return showError("agenda-err", `고민 제목은 ${LIMITS.title}자 이하로 적어 주세요.`);
        if (m.detail.length > LIMITS.detail) return showError("agenda-err", `고민 내용은 ${LIMITS.detail}자 이하로 적어 주세요.`);
        m.title = title;
        m.place = m.place.trim().slice(0, 30);
        if (m.place && !(m.date >= kstToday() && m.date <= addDays(kstToday(), 15))) return showError("agenda-err", "날짜는 오늘부터 15일 이내로 골라 주세요(날씨 예보 범위).");
        if (m.category === "쇼핑") {
          m.options = ["구매 승인", "하루 더 생각하기", "보류"];
          return renderShop();
        }
        const pairs = m.rawOptions.map((o, i) => [o.trim(), m.rawTags[i] || null]).filter(([o]) => o);
        const opts = pairs.map(p => p[0]);
        if (opts.some(o => o.length > LIMITS.option)) return showError("agenda-err", `선택지는 각각 ${LIMITS.option}자 이하로 적어 주세요.`);
        const seen = new Set();
        for (const o of opts) {
          if (seen.has(normalize(o))) return showError("agenda-err", `「${o}」${j(o,"가")} 두 번 적혀 있어요. 서로 다른 선택지를 적어 주세요.`);
          seen.add(normalize(o));
        }
        m.yesNo = opts.length < 2;
        const next = m.yesNo ? (opts.length === 1 ? [opts[0], "하지 않기"] : ["한다", "안 한다"]) : opts.slice(0, LIMITS.optionsMax);
        if (next.join("\u0000") !== m.options.join("\u0000")) m.answers = {}; // 선택지가 바뀌면 이전 답은 버린다
        m.options = next;
        m.optTags = !TAG_CATS.includes(m.category) ? [] : m.yesNo ? [opts.length === 1 ? pairs[0][1] : m.activityTag, "in"] : pairs.slice(0, LIMITS.optionsMax).map(p => p[1]);
        m.qIndex = 0;
        renderQuestion();
      };
    });
}

// ② 장관 질문(일반 고민): 장관마다 질문 하나, 답이 곧 그 장관의 표
function renderQuestion() {
  const m = meeting;
  const minister = MINISTERS[m.qIndex];
  const current = m.answers[minister.name];
  openModal("🏛️ 국무회의", `
    ${stepBar(1)}
    <div class="q-card">
      <img class="q-sprite" src="assets/${minister.img}.png" alt="${minister.animal} ${minister.name} 장관" />
      <div class="q-bubble">
        <div class="q-who">${minister.emoji} ${minister.name} 장관 <span class="q-count">질문 ${m.qIndex + 1} / ${MINISTERS.length}</span></div>
        <div class="q-text">${escapeHTML(minister.question)}</div>
      </div>
    </div>
    <div class="answer-row">
      <div class="face me-face">${userFace()}<small>${userName()}</small></div>
      <div class="answer-col">
    <div class="q-title">안건: ${escapeHTML(m.title)}</div>
    <div class="choice-list" role="group" aria-label="${escapeHTML(minister.question)}">
      ${m.options.map((o, i) => `<button type="button" class="choice" data-answer="${i}" aria-pressed="${current === i}">${escapeHTML(o)}</button>`).join("")}
      <button type="button" class="choice abstain" data-answer="-1" aria-pressed="${current === -1}">비슷해요 / 잘 모르겠어요</button>
    </div>
      </div>
    </div>
    <div class="btn-row">
      <button type="button" class="primary secondary" id="q-back">◀ 이전</button>
    </div>`, () => {
      modalRoot.querySelectorAll("[data-answer]").forEach(b => b.onclick = () => {
        m.answers[minister.name] = Number(b.dataset.answer);
        if (m.qIndex < MINISTERS.length - 1) { m.qIndex++; renderQuestion(); }
        else renderPriority();
      });
      document.getElementById("q-back").onclick = () => {
        if (m.qIndex > 0) { m.qIndex--; renderQuestion(); } else renderAgenda();
      };
      const first = modalRoot.querySelector('.choice[aria-pressed="true"]') || modalRoot.querySelector(".choice");
      if (first) first.focus();
    });
}

// ② 구매 심사(쇼핑): 가격·예산은 필수 정수 1~100,000,000, 범위 밖은 거부
function renderShop() {
  const m = meeting, s = m.shop;
  const seg = (key, items, label) => `
    <div class="field">
      <span class="label">${label}</span>
      <div class="chip-row" role="group" aria-label="${label}">
        ${items.map(([v, t]) => `<button type="button" class="chip" data-shop="${key}" data-val="${v}" aria-pressed="${String(s[key]) === v}">${t}</button>`).join("")}
      </div>
    </div>`;
  openModal("🛍️ 구매 재판", `
    ${stepBar(1)}
    <div class="q-card">
      <img class="q-sprite" src="assets/bear_desk.png" alt="곰 현실주의 장관" />
      <div class="q-bubble"><div class="q-who">🐻 현실주의 장관</div><div class="q-text">「${escapeHTML(m.title)}」, 숫자부터 확인하겠습니다!</div></div>
    </div>
    <form id="shop-form" novalidate>
      <div class="field-row">
        <div class="field">
          <label for="price">상품 가격</label>
          <div class="price-row">
            <input id="price" inputmode="decimal" autocomplete="off" value="${escapeHTML(s.price)}" placeholder="${s.currency === "KRW" ? "예) 59000" : "예) 49.99"}" aria-describedby="price-err" />
            <select id="currency" aria-label="통화">${FX_CURRENCIES.map(([c, n]) => `<option value="${c}" ${c === s.currency ? "selected" : ""}>${c === "KRW" ? "원" : c + " " + n}</option>`).join("")}</select>
          </div>
          ${s.currency !== "KRW" ? `<div class="hint">해외 가격은 오늘 기준환율로 원화로 바꿔 판단해요.</div>` : ""}
          <p class="err small" id="price-err" hidden></p>
        </div>
        <div class="field">
          <label for="budget">쓸 수 있는 예산 (원)</label>
          <input id="budget" inputmode="numeric" autocomplete="off" value="${escapeHTML(s.budget)}" placeholder="예) 80000" aria-describedby="budget-err" />
          <p class="err small" id="budget-err" hidden></p>
        </div>
      </div>
      ${seg("owned", [["true", "있어요"], ["false", "없어요"]], "비슷한 물건을 이미 가지고 있나요?")}
      ${seg("use", [["week", "이번 주 안에"], ["month", "한 달 안에"], ["unknown", "아직 모르겠어요"]], "언제 쓸 계획인가요?")}
      ${seg("need", [["high", "많이 불편해요"], ["mid", "조금 불편해요"], ["low", "별로 안 불편해요"]], "이게 없으면 얼마나 불편한가요?")}
      <p class="err" id="shop-err" role="alert" hidden></p>
      <div class="btn-row">
        <button type="button" class="primary secondary" id="shop-back">◀ 이전</button>
        <button type="submit" class="primary">다음 ▶</button>
      </div>
    </form>`, () => {
      const keep = () => { s.price = document.getElementById("price").value; s.budget = document.getElementById("budget").value; s.currency = document.getElementById("currency").value; };
      document.getElementById("currency").onchange = () => { keep(); renderShop(); };
      modalRoot.querySelectorAll("[data-shop]").forEach(b => b.onclick = () => {
        keep();
        const v = b.dataset.val;
        s[b.dataset.shop] = v === "true" ? true : v === "false" ? false : v;
        renderShop();
      });
      document.getElementById("shop-back").onclick = () => { keep(); renderAgenda(); };
      document.getElementById("shop-form").onsubmit = async event => {
        event.preventDefault();
        keep();
        const p = s.currency === "KRW" ? parseMoney(s.price) : parseForeign(s.price), b = parseMoney(s.budget);
        showError("price-err", p.error || ""); showError("budget-err", b.error || "");
        document.getElementById("price").setAttribute("aria-invalid", String(!!p.error));
        document.getElementById("budget").setAttribute("aria-invalid", String(!!b.error));
        if (p.error || b.error) return showError("shop-err", "가격과 예산을 다시 확인해 주세요.");
        if (s.owned === null || s.use === null || s.need === null) return showError("shop-err", "세 가지 질문에 모두 답해 주세요.");
        s.budgetValue = b.value; s.fx = null;
        if (s.currency === "KRW") { s.priceValue = p.value; return renderPriority(); }
        const btn = event.target.querySelector('button[type="submit"]'); btn.disabled = true; btn.textContent = "환율 확인 중…";
        const f = await infoGet({ type: "fx", from: s.currency });
        btn.disabled = false; btn.textContent = "다음 ▶";
        if (!f.ok) return showError("shop-err", `환율을 가져오지 못했어요(${f.reason}). 원화로 바꿔 입력해 주세요.`);
        const krw = Math.round(p.value * f.rate);
        if (krw < LIMITS.moneyMin || krw > LIMITS.moneyMax) return showError("shop-err", "원화로 바꾼 가격이 1원~1억 원 범위를 벗어나요.");
        s.foreignAmount = p.value; s.priceValue = krw; s.fx = f;
        renderPriority();
      };
    });
}

// ③ 가장 중요한 기준 (+ 되돌림·마감)
function renderPriority() {
  const m = meeting;
  const pairs = [["reversible", [["true", "쉽게 바꿀 수 있어요"], ["false", "되돌리기 어려워요"]], "나중에 되돌릴 수 있나요? (선택)"],
                 ["urgent", [["true", "오늘 안에 정해야 해요"], ["false", "여유가 있어요"]], "언제까지 정해야 하나요? (선택)"]];
  openModal("🏛️ 국무회의", `
    ${stepBar(2)}
    <div class="q-card">
      <img class="q-sprite" src="assets/cat_podium.png" alt="고양이 국무총리" />
      <div class="q-bubble"><div class="q-who">👑 국무총리</div><div class="q-text">마지막 질문입니다. 이번 고민에서 가장 중요한 건 무엇인가요? 고른 기준의 장관 표는 <b>1.5표</b>로 계산합니다.</div></div>
    </div>
    <div class="prio-grid" role="group" aria-label="가장 중요한 기준">
      ${MINISTERS.map(x => `<button type="button" class="prio" data-prio="${x.priority}" aria-pressed="${m.priority === x.priority}">
        <img src="assets/${x.img}.png" alt="" /><b>${PRIORITY_LABEL[x.priority]}</b><small>${x.name} 장관</small></button>`).join("")}
    </div>
    ${pairs.map(([key, items, label]) => `
      <div class="field">
        <span class="label">${label}</span>
        <div class="chip-row" role="group" aria-label="${label}">
          ${items.map(([v, t]) => `<button type="button" class="chip" data-ctx="${key}" data-val="${v}" aria-pressed="${String(m[key]) === v}">${t}</button>`).join("")}
        </div>
      </div>`).join("")}
    <p class="err" id="prio-err" role="alert" hidden></p>
    <div class="btn-row">
      <button type="button" class="primary secondary" id="prio-back">◀ 이전</button>
      <button type="button" class="primary" id="prio-go">⚒️ 표결 시작</button>
    </div>`, () => {
      modalRoot.querySelectorAll("[data-prio]").forEach(b => b.onclick = () => { m.priority = b.dataset.prio; renderPriority(); });
      modalRoot.querySelectorAll("[data-ctx]").forEach(b => b.onclick = () => {
        const key = b.dataset.ctx, v = b.dataset.val === "true";
        m[key] = m[key] === v ? null : v; // 다시 누르면 선택 해제
        renderPriority();
      });
      document.getElementById("prio-back").onclick = () => {
        if (m.category === "쇼핑") renderShop(); else { m.qIndex = MINISTERS.length - 1; renderQuestion(); }
      };
      document.getElementById("prio-go").onclick = () => {
        if (!m.priority) return showError("prio-err", "가장 중요한 기준을 하나 골라 주세요.");
        m.tiebreak = null;
        const needs = (WEATHER_CATS.includes(m.category) && m.place) || (m.category === "쇼핑" && m.shop.fx);
        const run = () => { const result = decide(m); if (result.tie) renderTiebreak(result); else showResult(m, result); };
        if (!needs) { m.evidence = null; return run(); }
        openModal("🏛️ 국무회의", `${stepBar(3)}<div class="empty"><img class="owl" src="assets/stand_owl.png" alt="" /><br><b>서기관 부엉이가 근거를 수집하는 중…</b><br><span class="hint">날씨·장소 정보를 확인하고 있어요</span></div>`);
        collectEvidence(m).then(run);
      };
    });
}

// 동점이면 국무총리가 한 번 더 묻는다
function renderTiebreak(result) {
  const m = meeting;
  openModal("🏛️ 국무회의", `
    ${stepBar(2)}
    <div class="q-card">
      <img class="q-sprite" src="assets/cat_podium.png" alt="고양이 국무총리" />
      <div class="q-bubble"><div class="q-who">👑 국무총리</div><div class="q-text">표가 똑같이 갈렸습니다! 둘 중 하나만 고른다면, 지금 마음이 조금이라도 더 가는 쪽은?</div></div>
    </div>
    <div class="choice-list" role="group" aria-label="동점 결선">
      ${result.tie.map(i => `<button type="button" class="choice" data-tb="${i}">${escapeHTML(m.options[i])}</button>`).join("")}
    </div>
    <div class="btn-row"><button type="button" class="primary secondary" id="tb-back">◀ 기준 다시 고르기</button></div>`, () => {
      modalRoot.querySelectorAll("[data-tb]").forEach(b => b.onclick = () => { m.tiebreak = Number(b.dataset.tb); showResult(m, decide(m)); });
      document.getElementById("tb-back").onclick = renderPriority;
    });
}

// 받침에 맞는 조사: j("마라탕","를") → "을", j("영화","로") → "로"
function j(word, particle) {
  const ch = String(word).trim().slice(-1), code = ch.charCodeAt(0) - 0xAC00;
  const hangul = code >= 0 && code <= 11171;
  const jong = hangul ? code % 28 : 0;
  const has = hangul ? jong !== 0 : /[0-9lmnLMN]$/.test(ch) && !/[2459]$/.test(ch);
  if (particle === "로") return has && jong !== 8 ? "으로" : "로";
  const pairs = { 를: ["을", "를"], 가: ["이", "가"], 는: ["은", "는"], 이라고: ["이라고", "라고"] };
  return has ? pairs[particle][0] : pairs[particle][1];
}

// ===== 근거 수집: 실시간 정보를 서버 함수(/api/info)로 받아 판결 근거로 쓴다 =====
const WEATHER_CATS = ["나들이", "맛집"];
const TAG_CATS = ["나들이"];
const FX_CURRENCIES = [["KRW", "원"], ["USD", "달러"], ["JPY", "엔"], ["EUR", "유로"], ["CNY", "위안"], ["GBP", "파운드"], ["THB", "바트"]];

function kstToday() { return new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10); }
function addDays(d, n) { return new Date(Date.parse(d) + n * 86400e3).toISOString().slice(0, 10); }
function hhmm(iso) { const d = new Date(iso); return isNaN(d) ? "" : `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; }
function ago(iso) {
  const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  return m < 1 ? "방금" : m < 60 ? `${m}분 전` : `${Math.round(m / 60)}시간 전`;
}
function mmdd(d) { return d ? `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}` : ""; }

async function infoGet(params) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);
  try {
    const q = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => [].concat(v).forEach(x => q.append(k, x)));
    const r = await fetch("/api/info?" + q.toString(), { signal: ctrl.signal });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok) return { ok: false, reason: j.reason || "정보 서버에 연결하지 못했어요" };
    return j;
  } catch (e) {
    return { ok: false, reason: e.name === "AbortError" ? "응답이 늦어 기다리지 않았어요" : "정보 서버에 연결하지 못했어요" };
  } finally { clearTimeout(t); }
}

function evidenceKey(m) {
  return JSON.stringify([m.category, m.place, m.date, m.weatherOn, m.options, m.shop && m.shop.fx && m.shop.fx.rate]);
}

// 유형별로 필요한 정보만 조회한다. 일상(연애·게임 등 포함)은 외부 정보를 조회하지 않는다.
async function collectEvidence(m) {
  if (m.evidence && m.evidence.key === evidenceKey(m)) return m.evidence;
  const ev = { key: evidenceKey(m), items: [] };
  const jobs = [];
  const place = (m.place || "").trim();
  const wantWeather = WEATHER_CATS.includes(m.category) && place;
  if (wantWeather) {
    const date = m.date || kstToday();
    if (date < kstToday() || date > addDays(kstToday(), 15)) {
      ev.items.push({ kind: "weather", ok: false, label: "🌦️ 날씨", reason: "예보는 오늘부터 15일 이내만 볼 수 있어 반영하지 않았어요" });
    } else jobs.push(infoGet({ type: "weather", place, date }).then(w => { ev.weather = w.ok ? w : null; ev.items.push(weatherItem(w, place, date)); }));
  }
  if (m.category === "나들이" && m.date) {
    jobs.push(infoGet({ type: "holiday", date: m.date }).then(h => { ev.holiday = h.ok ? h : null; ev.items.push(holidayItem(h)); }));
  }
  if (m.category === "맛집" && place && !m.yesNo) {
    jobs.push(infoGet({ type: "places", near: place, q: m.options }).then(p => { ev.places = p.ok ? p : null; ev.items.push(placesItem(p)); }));
  }
  if (m.category === "쇼핑" && m.shop.fx) ev.items.push(fxItem(m.shop));
  await Promise.all(jobs);
  const order = ["weather", "holiday", "places", "fx"];
  ev.items.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
  m.evidence = ev;
  return ev;
}

function weatherFlags(w) {
  if (!w) return { bad: [], good: false };
  const bad = [];
  if (w.rain != null && w.rain >= 60) bad.push(`비 예보(강수확률 ${w.rain}%)`);
  if ((w.pm10 != null && w.pm10 > 80) || (w.pm25 != null && w.pm25 > 35)) bad.push(`미세먼지 나쁨(PM10 ${w.pm10 ?? "-"}, PM2.5 ${w.pm25 ?? "-"})`);
  if (w.tmax != null && w.tmax >= 33) bad.push(`폭염(최고 ${Math.round(w.tmax)}℃)`);
  if (w.tmax != null && w.tmax <= -5) bad.push(`한파(최고 ${Math.round(w.tmax)}℃)`);
  const good = !bad.length && w.rain != null && w.rain <= 20 && w.tmax != null && w.tmax >= 5 && w.tmax <= 30;
  return { bad, good };
}
function pmGrade(v, cut) { return v == null ? "-" : v <= cut[0] ? "좋음" : v <= cut[1] ? "보통" : v <= cut[2] ? "나쁨" : "매우 나쁨"; }

function weatherItem(w, place, date) {
  if (!w.ok) return { kind: "weather", ok: false, label: `🌦️ 날씨 · ${place}`, reason: w.reason };
  const lines = [];
  if (w.rain != null) lines.push(`강수확률 ${w.rain}%`);
  if (w.tmax != null) lines.push(`기온 ${Math.round(w.tmin)}~${Math.round(w.tmax)}℃`);
  if (w.pm10 != null) lines.push(`미세먼지 ${pmGrade(w.pm10, [30, 80, 150])}(PM10 ${w.pm10}) · 초미세 ${pmGrade(w.pm25, [15, 35, 75])}(PM2.5 ${w.pm25})`);
  if (w.uv != null) lines.push(`자외선 지수 ${Math.round(w.uv)}`);
  if (w.sunset) lines.push(`일몰 ${w.sunset}`);
  return { kind: "weather", ok: true, label: `🌦️ 날씨 · ${w.place} ${mmdd(date)}`, lines, source: w.source, fetchedAt: w.fetchedAt,
    fresh: `${mmdd(date)} 예보 · 조회 ${hhmm(w.fetchedAt)}(${ago(w.fetchedAt)})${w.pm10 != null ? " · 대기질은 예측 모델 값" : ""}` };
}
function holidayItem(h) {
  if (!h.ok) return { kind: "holiday", ok: false, label: "📅 공휴일", reason: h.reason };
  const lines = [h.holiday ? `${h.holiday} (공휴일)` : "공휴일 아님", h.longWeekend ? `${h.offDays}일 연휴 기간` : h.offDays ? "주말·휴일" : "평일"];
  return { kind: "holiday", ok: true, label: `📅 공휴일 · ${mmdd(h.date)}`, lines, source: h.source, fetchedAt: h.fetchedAt, fresh: `조회 ${hhmm(h.fetchedAt)}` };
}
function placesItem(p) {
  if (!p.ok) return { kind: "places", ok: false, label: "📍 장소 거리", reason: p.reason };
  const lines = p.places.map(x => x.name ? `${x.option} → ${x.name} · ${x.distance != null ? (x.distance >= 1000 ? (x.distance / 1000).toFixed(1) + "km" : x.distance + "m") : "거리 모름"}` : `${x.option} → 근처에서 찾지 못함`);
  return { kind: "places", ok: true, label: `📍 ${p.near}에서 거리`, lines, source: p.source, fetchedAt: p.fetchedAt, fresh: `조회 ${hhmm(p.fetchedAt)}(${ago(p.fetchedAt)}) · 직선거리 기준` };
}
function fxItem(s) {
  const f = s.fx;
  return { kind: "fx", ok: true, label: `💱 환율 · ${f.from}`, lines: [`1 ${f.from} = ${f.rate.toLocaleString(undefined, { maximumFractionDigits: 2 })}원`, `${s.foreignAmount.toLocaleString()} ${f.from} ≈ ${s.priceValue.toLocaleString()}원`],
    source: f.source, fetchedAt: f.fetchedAt, fresh: `${f.rateDate} 기준환율(영업일 하루 1회 갱신)` };
}

// 근거에 따라 장관의 표를 조정한다(공개 규칙). 반환: { votes, moves[], notes{} }
function adjustVotes(m, base) {
  const votes = { ...base }, moves = [], notes = {};
  const ev = m.evidence;
  if (!ev) return { votes, moves, notes };
  const n = m.options.length;
  const note = (name, t) => { notes[name] = (notes[name] ? notes[name] + " " : "") + t; };
  const move = (name, to, why) => { if (votes[name] === to) return; moves.push({ name, from: votes[name], to, why }); votes[name] = to; };

  // 날씨 × 실내/야외
  const w = ev.weather, f = weatherFlags(w);
  const tags = m.optTags || [];
  const outdoor = m.options.map((_, i) => i).filter(i => tags[i] === "out");
  const shelter = m.options.map((_, i) => i).filter(i => tags[i] !== "out" && (tags[i] === "in" || (m.yesNo && i === 1)));
  if (w && outdoor.length) {
    if (f.bad.length && shelter.length) {
      const why = f.bad.join(", ");
      const target = shelter.slice().sort((a, b) => MINISTERS.filter(x => votes[x.name] === b).length - MINISTERS.filter(x => votes[x.name] === a).length)[0];
      if (outdoor.includes(votes["신중주의"])) move("신중주의", target, `${why} 소식 때문에 야외인 「${m.options[votes["신중주의"]]}」 대신 「${m.options[target]}」${j(m.options[target], "로")} 표를 옮깁니다.`);
      else note("신중주의", `${why} 소식이 있어 야외 선택지는 피하는 게 안전합니다.`);
      if (outdoor.includes(votes["낭만주의"])) note("낭만주의", `${why} 소식이 있어 야외 만족도는 떨어지겠지만, 마음이 끌리는 쪽이라 표는 그대로 둡니다.`);
      note("행동파", `${why} 소식이 있으니 날짜를 바꾸거나 실내 대안을 준비해 두세요.`);
    } else if (f.good) {
      if (votes["낭만주의"] < 0) move("낭만주의", outdoor[0], `날씨가 좋아서(강수확률 ${w.rain}%) 기권 대신 야외인 「${m.options[outdoor[0]]}」에 한 표 드립니다.`);
      else note("낭만주의", `날씨도 좋아요(강수확률 ${w.rain}%).`);
    }
  } else if (w && f.bad.length) note("신중주의", `참고로 ${f.bad.join(", ")} 소식이 있습니다.`);

  // 공휴일(나들이)
  const h = ev.holiday;
  if (h && h.longWeekend) {
    note("현실주의", `${h.offDays}일 연휴라 숙소·교통비가 오르고 붐빌 수 있습니다.`);
    if (m.yesNo && votes["행동파"] < 0) move("행동파", 0, `${h.offDays}일 연휴라 떠나기 좋은 때입니다. 기권 대신 「${m.options[0]}」에 한 표!`);
    else note("행동파", `${h.offDays}일 연휴라 시간은 충분합니다.`);
  }

  // 장소 거리(맛집)
  const p = ev.places;
  if (p) {
    const dist = m.options.map((o, i) => { const x = p.places[i]; return x && x.name && x.distance != null ? x.distance : null; });
    const known = dist.map((d, i) => [d, i]).filter(([d]) => d != null).sort((a, b) => a[0] - b[0]);
    if (known.length >= 2) {
      const [dc, c] = known[0];
      const km = d => (d >= 1000 ? (d / 1000).toFixed(1) + "km" : d + "m");
      const vB = votes["행동파"];
      if (vB < 0 || (dist[vB] != null && dist[vB] - dc >= 1000)) move("행동파", c, `가장 가까운 「${m.options[c]}」(${km(dc)})${j(m.options[c], "로")} 갑시다. 가까워야 바로 실행할 수 있습니다.`);
      if (w && w.rain != null && w.rain >= 60) {
        const vS = votes["신중주의"];
        if (vS >= 0 && dist[vS] != null && dist[vS] - dc >= 500) move("신중주의", c, `비 예보(강수확률 ${w.rain}%)가 있어 가까운 「${m.options[c]}」(${km(dc)})${j(m.options[c], "로")} 표를 옮깁니다.`);
      }
      note("현실주의", `이동 거리는 ${known.map(([d, i]) => `${m.options[i]} ${km(d)}`).join(", ")}입니다.`);
    }
  }
  return { votes, moves, notes };
}

function evidenceCard(it) {
  if (!it.ok) return `<div class="ev fail"><b>${escapeHTML(it.label)}</b><div>⚠️ ${escapeHTML(it.reason)} — 이 정보는 반영하지 않고 판단합니다.</div></div>`;
  return `<div class="ev"><b>${escapeHTML(it.label)}</b><ul>${it.lines.map(l => `<li>${escapeHTML(l)}</li>`).join("")}</ul><small>출처: ${escapeHTML(it.source)} · ${escapeHTML(it.fresh || "")}</small></div>`;
}

// ===== 판결 규칙 (AI 미사용, 같은 입력이면 항상 같은 결과) =====
function variant(seed, list) {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return list[h % list.length];
}

function decide(m) {
  return m.category === "쇼핑" ? decideShop(m) : decideGeneral(m);
}

function marginLabel(count, winner, voters, allSame) {
  if (allSame && voters >= 3) return "만장일치";
  const sorted = [...count].sort((a, b) => b - a);
  const diff = sorted[0] - (sorted[1] || 0);
  return diff >= 2 ? "압도적 우세" : diff >= 1 ? "우세" : "근소한 차이";
}

// "하지 않는다", "안 산다" 같은 '하지 않는' 선택지인지
function isNegative(m, i) {
  const o = String(m.options[i] || "");
  return (m.yesNo && i === 1) || /(하지\s?않|않는다|않기|않을래|안\s?(한|함|해|할|하|가|사|먹|볼|봐)|말기|말자|그만|포기)/.test(o);
}

function tallyOf(m, votes) {
  const count = m.options.map(() => 0);
  MINISTERS.forEach(x => { if (votes[x.name] >= 0) count[votes[x.name]] += x.priority === m.priority ? 1.5 : 1; }); // 중요 기준 장관은 1.5표
  return count;
}
function topOf(count) { const max = Math.max(...count); return count.map((c, i) => (c === max && max > 0 ? i : -1)).filter(i => i >= 0); }

function decideGeneral(m) {
  const base = {};
  MINISTERS.forEach(x => {
    const a = Number.isInteger(m.answers[x.name]) ? m.answers[x.name] : -1;
    base[x.name] = a >= 0 && a < m.options.length ? a : -1;
  });
  const { votes, moves, notes } = adjustVotes(m, base); // 실시간 근거로 표 조정(공개 규칙)
  const count = tallyOf(m, votes);
  const baseTop = topOf(tallyOf(m, base));
  const adj = { moves, notes, base, baseCount: tallyOf(m, base), baseWinner: baseTop.length === 1 ? baseTop[0] : -1 };
  const voters = MINISTERS.filter(x => votes[x.name] >= 0);
  const abstain = MINISTERS.length - voters.length;
  if (!voters.length) {
    return { ...adj, votes, count, abstain, winner: -1, verdict: "판단 보류!", label: "전원 기권",
      pmLine: "장관 전원이 기권했습니다. 선택지끼리 차이가 거의 없다는 뜻이에요. 정보를 조금 더 모은 뒤 재심을 청구해 주세요.",
      nextLine: "각 선택지의 가격·거리·소요 시간 중 하나만이라도 찾아본 뒤 다시 회의해 보세요." };
  }
  const max = Math.max(...count);
  const top = count.map((c, i) => (c === max ? i : -1)).filter(i => i >= 0);
  let winner, label, pmExtra = "";
  if (top.length > 1) {
    if (m.tiebreak === null || !top.includes(m.tiebreak)) return { ...adj, tie: top, votes, count, abstain };
    winner = m.tiebreak; label = "박빙 · 총리 결선";
    pmExtra = " 동점이라 국무총리 결선 질문으로 정했습니다.";
  } else {
    winner = top[0];
    label = marginLabel(count, winner, voters.length, voters.every(x => votes[x.name] === winner));
  }
  const win = m.options[winner];
  const decider = MINISTERS.find(x => x.priority === m.priority);
  const deciderNote = votes[decider.name] >= 0
    ? ` 가장 중요한 기준(${PRIORITY_LABEL[m.priority]})을 맡은 ${decider.name} 장관의 표는 1.5표로 계산했습니다.`
    : ` 가장 중요한 기준(${PRIORITY_LABEL[m.priority]})을 맡은 ${decider.name} 장관은 기권했습니다.`;
  const changed = adj.baseWinner >= 0 && adj.baseWinner !== winner;
  if (changed) pmExtra += ` 근거에 따라 표가 조정되어, 조정 전 1위였던 「${m.options[adj.baseWinner]}」 대신 「${win}」${j(win, "가")} 1위가 되었습니다.`;
  return {
    ...adj, changed, votes, count, abstain, winner, label, verdict: `${win}!`,
    pmLine: `「${win}」${j(win,"로")} 결정합니다.${pmExtra}${deciderNote}`,
    nextLine: isNegative(m, winner)
      ? "이번에는 하지 않기로 했어요. 마음이 바뀌면 재심 청구로 다시 회의해 보세요."
      : m.urgent === true ? `오늘 안에 「${win}」${j(win,"를")} 위한 첫 행동 하나를 바로 해 보세요.` : `「${win}」${j(win,"를")} 위해 지금 할 수 있는 가장 작은 행동 하나를 정해 보세요.`
  };
}

function generalOpinion(x, m, r) {
  const mv = (r.moves || []).find(v => v.name === x.name);
  const extra = r.notes && r.notes[x.name] ? " " + r.notes[x.name] : "";
  if (mv) return mv.why + extra;
  return baseOpinion(x, m, r) + extra;
}
function baseOpinion(x, m, r) {
  const a = r.votes[x.name];
  const opt = a >= 0 ? m.options[a] : "";
  const seed = m.title + x.name;
  const tailR = m.reversible === true ? "R1" : m.reversible === false ? "R0" : "";
  const tailU = m.urgent === true ? "U1" : m.urgent === false ? "U0" : "";
  const T = {
    신중주의: { pick: [`후회가 가장 적을 것 같다고 하신 「${opt}」${j(opt,"를")} 지지합니다.`, `나중에 돌아봐도 아쉽지 않을 쪽은 「${opt}」${j(opt,"이라고")} 보셨죠. 저도 같은 생각입니다.`],
      abstain: "후회할 정도는 비슷하다고 하셨으니 이번에는 기권하겠습니다.",
      R1: " 다시 바꿀 수 있는 선택이라 부담도 적습니다.", R0: " 되돌리기 어려운 선택이니 결정 전에 놓친 정보가 없는지 한 번만 더 확인하세요." },
    낭만주의: { pick: [`가장 끌린다고 하신 「${opt}」! 마음이 가는 쪽이 만족도도 큽니다.`, `설레는 쪽이 정답일 때가 많아요. 저는 「${opt}」에 한 표!`],
      abstain: "둘 다 끌린다니 행복한 고민이네요! 저는 기권합니다.",
      R1: " 되돌릴 수 있으니 기분 좋은 쪽으로 가 봐요.", R0: " 오래 남을 선택일수록 마음이 중요합니다." },
    현실주의: { pick: [`돈과 시간이 가장 덜 든다고 하신 「${opt}」에 한 표 드립니다.`, `부담이 가장 적은 「${opt}」${j(opt,"가")} 합리적입니다.`],
      abstain: "비용 차이가 크지 않다고 하셨으니 기권하겠습니다.",
      U1: " 오늘 안에 정해야 하니 부담이 적은 쪽이 안전합니다.", U0: " 여유가 있다면 실제 비용을 한 번 더 비교해 보세요." },
    행동파: { pick: [`지금 바로 할 수 있는 「${opt}」! 일단 시작하면 고민이 줄어듭니다.`, `고민은 짧게, 실행은 빠르게! 「${opt}」${j(opt,"로")} 갑시다.`],
      abstain: "어느 쪽도 바로 하기 어렵다면 이번엔 쉬겠습니다.",
      U1: " 오늘 정해야 하니 바로 실행하세요.", U0: " 작게 먼저 해 보고 다시 판단해도 늦지 않습니다." }
  }[x.name];
  if (a < 0) return T.abstain;
  if (isNegative(m, a)) {
    const N = {
      신중주의: `하지 않는 쪽이 후회가 적을 것 같다고 하셨죠. 「${opt}」에 한 표, 이번엔 쉬어 가도 괜찮습니다.`,
      낭만주의: `마음이 크게 끌리지 않는다면 억지로 할 필요는 없어요. 「${opt}」에 한 표!`,
      현실주의: `돈과 시간을 아끼는 쪽은 「${opt}」입니다. 한 표 드립니다.`,
      행동파: `지금 당장 하기 어렵다면 「${opt}」도 괜찮아요. 대신 다시 정할 날짜를 하나 잡아 두세요.`
    };
    return N[x.name] + (x.name === "행동파" ? "" : (T[tailR] || "") + (T[tailU] || ""));
  }
  return variant(seed, T.pick) + (T[tailR] || "") + (T[tailU] || "");
}

function decideShop(m) {
  const s = m.shop;
  const pct = Math.round(s.priceValue / s.budgetValue * 100);
  const rule = {
    현실주의: pct > 100 ? [2, `가격이 예산보다 ${pct - 100}% 비쌉니다.`]
            : pct >= 70 ? [1, `예산의 ${pct}%를 한 번에 씁니다. 다른 지출부터 확인해 보세요.`]
            : [0, `예산의 ${pct}% 수준이라 부담이 적습니다.`],
    신중주의: s.owned && s.need !== "high" ? [2, "비슷한 물건이 있고, 없어도 크게 불편하지 않다고 하셨습니다."]
            : s.owned ? [1, "비슷한 물건이 있으니 새로 필요한 이유를 한 줄로 적어 보세요."]
            : s.need === "low" ? [1, "없어도 불편하지 않다면 하루만 더 지켜봅시다."]
            : [0, "겹치는 물건이 없고 필요도 분명합니다."],
    낭만주의: s.owned && s.need === "low" ? [1, "설렘만으로 사기엔 이미 비슷한 게 있네요."]
            : [0, "갖고 싶은 마음도 충분한 이유입니다!"],
    행동파: s.use === "week" ? [0, "이번 주에 바로 쓴다면 미룰 이유가 없습니다."]
          : s.use === "month" ? [1, "한 달 안에 쓸 거라면 할인과 후기를 확인할 시간이 있습니다."]
          : [2, "언제 쓸지 모르면 지금 살 필요는 없습니다."]
  };
  if (s.fx) rule.현실주의[1] = `${s.foreignAmount.toLocaleString()} ${s.fx.from}는 기준환율로 약 ${s.priceValue.toLocaleString()}원입니다. ` + rule.현실주의[1];
  const votes = {}, reasons = {}, count = [0, 0, 0];
  MINISTERS.forEach(x => {
    const [v, why] = rule[x.name];
    votes[x.name] = v; reasons[x.name] = why;
    count[v] += x.priority === m.priority ? 1.5 : 1;
  });
  // 장관 4명이 모두 투표하고 한 명만 1.5표라 1위 동점은 생기지 않는다.
  let winner = count.indexOf(Math.max(...count));
  let label = marginLabel(count, winner, 4, MINISTERS.every(x => votes[x.name] === winner));
  let pmExtra = "";
  if (pct > 100 && winner !== 2) { winner = 2; label = "총리 직권"; pmExtra = " 가격이 예산을 넘으면 표결과 관계없이 국무총리 직권으로 보류합니다."; }
  const verdict = `${m.options[winner]}!`;
  const next = winner === 0 ? "사기 전에 같은 상품의 최저가와 반품 조건만 확인하세요."
    : winner === 1 ? "장바구니에 담아 두고 내일 같은 시간에 다시 열어 보세요. 그래도 갖고 싶다면 그때 사도 늦지 않습니다."
    : "지금은 사지 않기로 해요. 정말 필요해지면 재심을 청구해 주세요.";
  return {
    votes, count, abstain: 0, winner, label, verdict, reasons, pct,
    pmLine: `「${m.options[winner]}」${j(m.options[winner],"로")} 판결합니다.${pmExtra} 가장 중요한 기준(${PRIORITY_LABEL[m.priority]}) 장관의 표는 1.5표로 계산했습니다.`,
    nextLine: next
  };
}

function opinionsOf(m, r) {
  return MINISTERS.map(x => {
    const a = r.votes[x.name];
    const text = m.category === "쇼핑" ? r.reasons[x.name] : generalOpinion(x, m, r);
    return { name: x.name, pick: a >= 0 ? m.options[a] : null, text };
  });
}

// ④ 결재 화면
// ===== 결재: 실시간 대화처럼 장관들이 차례로 발언한다 =====
const SPEAKERS = {
  pm:  { name: "국무총리", img: "assets/stand_cat.png", cls: "pm" },
  owl: { name: "서기관 부엉이", img: "assets/stand_owl.png", cls: "scribe" }
};
function userFace() {
  const id = getAvatar();
  return id ? `<img src="assets/people/person_${id}.png" alt="내 캐릭터" />` : `<span class="face-emoji" aria-hidden="true">🙋</span>`;
}
function userName() {
  return currentUser ? "민원인(나)" : "민원인(체험)";
}
function reduceMotion() {
  try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; }
}

function chatLine(who, html, extra = "") {
  if (who === "stage") return `<div class="stage" data-who="stage">${html}</div>`;
  if (who === "user") {
    return `<div class="msg me ${extra}" data-who="user"><div class="bubble">${html}</div><div class="face">${userFace()}<small>${userName()}</small></div></div>`;
  }
  const sp = SPEAKERS[who] || (() => { const x = MINISTERS.find(y => y.name === who); return { name: `${x.name} 장관`, img: `assets/${x.stand}.png`, cls: x.priority }; })();
  return `<div class="msg them ${sp.cls} ${extra}" data-who="${escapeHTML(who)}"><div class="face"><img src="${sp.img}" alt="" /><small>${escapeHTML(sp.name)}</small></div><div class="bubble">${html}</div></div>`;
}

function buildRecord(m, r, ops) {
  const fmt = n => (Number.isInteger(n) ? n : n.toFixed(1));
  const tally = m.options.map((o, i) => `${o} ${fmt(r.count[i])}표`).join(" · ") + (r.abstain ? ` · 기권 ${r.abstain}` : "");
  return {
    title: m.title, verdict: r.verdict, category: m.category, date: today(),
    icon: categoryIcon(m.category), detail: m.detail.trim(), priority: m.priority, tally,
    label: r.label, retrial: m.retrial, options: m.options.slice(), counts: r.count.slice(), winner: r.winner,
    opinions: ops.map(o => [o.name, (o.pick ? `「${o.pick}」 — ` : "기권 — ") + o.text]),
    evidence: (m.evidence ? m.evidence.items : []).map(it => ({ label: it.label, ok: it.ok, summary: it.ok ? it.lines.join(" · ") : it.reason, source: it.source || "", fetchedAt: it.fetchedAt || null })),
    moves: (r.moves || []).map(v => ({ name: v.name, from: v.from >= 0 ? m.options[v.from] : "기권", to: m.options[v.to] })),
    createdAt: Date.now()
  };
}

// 같은 사람이 연달아 말하면 얼굴은 첫 말풍선에만 보여 준다(채팅 앱처럼)
function groupChat(chat) {
  let prev = null;
  chat.querySelectorAll(".msg:not(.typing)").forEach(el => {
    el.classList.toggle("cont", prev === el.dataset.who);
    prev = el.dataset.who;
  });
}

function showResult(m, r) {
  const ops = opinionsOf(m, r);
  const record = buildRecord(m, r, ops);
  const fmt = n => (Number.isInteger(n) ? n : n.toFixed(1));
  const total = r.count.reduce((a, b) => a + b, 0) || 1;
  const shop = m.category === "쇼핑";
  const winName = r.winner >= 0 ? m.options[r.winner] : "";

  // 대화 대본: [말하는 사람, 내용(HTML, 사용자 입력은 모두 escape), 추가 클래스]
  const script = [];
  script.push(["stage", "① 안건 정리"]);
  script.push(["user", `<b>안건 접수합니다!</b><br>「${escapeHTML(m.title)}」${shop
    ? `<div class="sub">가격 ${m.shop.priceValue.toLocaleString()}원 · 예산 ${m.shop.budgetValue.toLocaleString()}원</div>`
    : `<div class="sub">${m.options.map(o => `<span class="opt-tag">${escapeHTML(o)}</span>`).join("")}</div>`}`]);
  script.push(["pm", `${m.retrial ? "재심 청구가 접수되었습니다. " : ""}지금부터 국무회의를 시작하겠습니다! 가장 중요한 기준은 <b>${PRIORITY_LABEL[m.priority]}</b>입니다. 장관들은 차례로 의견을 말해 주세요.`]);
  const ev = m.evidence;
  script.push(["stage", "② 근거 수집"]);
  if (ev && ev.items.length) {
    script.push(["owl", `수집한 근거입니다.${ev.items.map(evidenceCard).join("")}`, "wide"]);
  } else {
    script.push(["owl", WEATHER_CATS.includes(m.category) ? "지역을 적지 않아 외부 정보 없이 입력한 답만으로 판단합니다. (지역을 적으면 날씨 등을 반영해요)"
      : "일상 고민은 개인정보 보호를 위해 외부 정보를 조회하지 않고, 입력한 답만으로 판단합니다."]);
  }
  script.push(["stage", "③ 장관별 검토"]);
  ops.forEach(o => {
    const x = MINISTERS.find(y => y.name === o.name);
    const pick = o.pick ? `<span class="pick-chip">${escapeHTML(o.pick)}</span>` : `<span class="pick-chip none">기권</span>`;
    const weight = x.priority === m.priority ? `<span class="badge">결정권 1.5표</span>` : "";
    script.push([o.name, `<div class="m-head">${pick}${weight}</div>${escapeHTML(o.text)}`]);
  });
  script.push(["stage", "④ 표결 및 이견 조정"]);
  if (r.moves && r.moves.length) {
    script.push(["pm", `근거에 따라 표가 조정되었습니다.<div class="moves">${r.moves.map(v => `<div>🔁 ${escapeHTML(v.name)}: ${v.from >= 0 ? `「${escapeHTML(m.options[v.from])}」` : "기권"} → 「${escapeHTML(m.options[v.to])}」</div>`).join("")}</div>${
      r.changed ? `<div class="hint">조정 전 1위는 「${escapeHTML(m.options[r.baseWinner])}」${j(m.options[r.baseWinner], "가") === "이" ? "이었" : "였"}습니다.</div>` : `<div class="hint">조정 후에도 1위는 바뀌지 않았습니다.</div>`}`]);
  }
  script.push(["pm", `개표 결과를 발표합니다.
    <div class="tally" aria-label="개표 결과">
      ${m.options.map((o, i) => `
        <div class="tally-row ${i === r.winner ? "win" : ""}">
          <span class="tally-name">${escapeHTML(o)}</span>
          <span class="bar"><span style="width:${Math.round(r.count[i] / total * 100)}%"></span></span>
          <span class="tally-num">${fmt(r.count[i])}표</span>
        </div>`).join("")}
      ${r.abstain ? `<div class="hint">기권 ${r.abstain}명</div>` : ""}
    </div>`, "wide"]);
  script.push(["stage", "⑤ 최종 판결문"]);
  const okEv = ev ? ev.items.filter(it => it.ok) : [];
  script.push(["pm", `<div class="label-chip">${escapeHTML(r.label)}</div>
    <div class="verdict-line">판결: <b>${escapeHTML(r.verdict)}</b><span class="stamp" aria-hidden="true">결재</span></div>
    <div class="pm-line">${escapeHTML(r.pmLine)}</div>
    ${okEv.length ? `<div class="ev-foot">근거: ${okEv.map(it => `${escapeHTML(it.label)} (${escapeHTML(it.source)}, ${escapeHTML(it.fresh || "")})`).join(" / ")}</div>` : ""}`, "verdict-msg"]);
  const minority = r.winner >= 0 ? ops.filter(o => o.pick && o.pick !== winName) : [];
  if (minority.length) {
    script.push(["pm", `<b>소수 의견</b>도 기록합니다.<br>${minority.map(o => {
      const x = MINISTERS.find(y => y.name === o.name);
      return `· ${x.name}: 「${escapeHTML(o.pick)}」 — ${PRIORITY_LABEL[x.priority]}${j(PRIORITY_LABEL[x.priority], "를")} 더 중시한다면 이쪽도 좋은 선택입니다.`;
    }).join("<br>")}`]);
  }
  script.push(["pm", `👉 다음 할 일: ${escapeHTML(r.nextLine)}`]);
  script.push(["owl", `<span id="clerk-msg" role="status">기록하는 중…</span>`]);

  openModal(shop ? "📜 구매 재판" : "📜 국무회의 결재", `
    ${stepBar(3)}
    <div class="chat" id="chat" aria-live="polite"></div>
    <div class="chat-tools"><button type="button" class="link-btn" id="chat-skip">끝까지 바로 보기 ⏭</button></div>
    <div id="chat-end" hidden>
      <div class="notice">이 결과는 입력한 답과 공개된 규칙으로 만든 참고 의견입니다. 중요한 결정은 관련 정보를 직접 확인해 주세요.</div>
      <div class="btn-row three">
        <button class="primary secondary" id="result-reconsider">♟️ 재심 청구</button>
        <button class="primary secondary" id="result-share">📤 판결문 공유</button>
        <button class="primary" id="result-done">닫기 ✓</button>
      </div>
      <button type="button" class="link-btn poll-ask" id="result-poll">📮 장관 판결이 아쉽다면? 국민 여론에도 물어보기</button>
    </div>`, () => {
      const chat = document.getElementById("chat");
      const modalBox = modalRoot.querySelector(".modal");
      let i = 0, timer = null, done = false, saveRes = null;
      const save = addRecord(record, m).then(res => { saveRes = res; showRecent(); paintClerk(); });
      function paintClerk() {
        const el = document.getElementById("clerk-msg");
        if (!el || !saveRes) return;
        el.textContent = saveRes.ok
          ? (saveRes.source === "server" ? "내 계정의 결정 기록실에 적어 두었습니다!" : "이 브라우저의 기록실에 적어 두었습니다! (체험 모드 — 로그인하면 계정에 저장돼요)")
          : "기록하지 못했어요. " + (saveRes.source === "server" ? dbMessage(saveRes.error) : "브라우저 저장소를 쓸 수 없어요.");
      }
      function scrollDown() { if (modalBox) modalBox.scrollTop = modalBox.scrollHeight; }
      function finish() {
        if (done) return; done = true; clearTimeout(timer);
        const typing = chat.querySelector(".typing"); if (typing) typing.remove();
        while (i < script.length) chat.insertAdjacentHTML("beforeend", chatLine(...script[i++]));
        document.getElementById("chat-skip").parentElement.hidden = true;
        document.getElementById("chat-end").hidden = false;
        groupChat(chat); paintClerk(); scrollDown();
      }
      function step() {
        if (done) return;
        if (i >= script.length) return finish();
        const [who] = script[i];
        const typing = who === "user" || who === "stage" ? "" : chatLine(who, `<span class="dots"><i></i><i></i><i></i></span>`, "typing");
        if (typing) chat.insertAdjacentHTML("beforeend", typing);
        scrollDown();
        timer = setTimeout(() => {
          const t = chat.querySelector(".typing"); if (t) t.remove();
          chat.insertAdjacentHTML("beforeend", chatLine(...script[i++]));
          groupChat(chat); paintClerk(); scrollDown();
          timer = setTimeout(step, who === "user" ? 350 : 550);
        }, who === "user" || who === "stage" ? 120 : 700);
      }
      if (reduceMotion()) finish(); else step();
      document.getElementById("chat-skip").onclick = finish;
      document.getElementById("result-done").onclick = closeModal;
      document.getElementById("result-poll").onclick = () => openPollForm({
        title: m.title, category: m.category,
        options: shop ? ["산다", "안 산다"] : m.options
      });
      document.getElementById("result-share").onclick = () => save.then(() => openShare(record));
      document.getElementById("result-reconsider").onclick = () => {
        m.retrial = true; m.tiebreak = null; m.qIndex = 0;
        if (m.category === "쇼핑") renderShop(); else renderQuestion();
      };
    });
}

// ===== 판결문 공유: 문구 복사 / 이미지 저장 / 기기 공유 =====
function verdictText(rec) {
  return `[결정국 판결문]\n안건: ${rec.title}\n판결: ${rec.verdict}${rec.label ? ` (${rec.label})` : ""}\n${rec.tally || ""}\n— 고민은 접수하고, 결정은 즐겁게! ${location.origin}`;
}

function drawVerdictImage(rec) {
  const W = 1080, H = 1080, c = document.createElement("canvas");
  c.width = W; c.height = H;
  const g = c.getContext("2d");
  const font = (w, s) => `${w} ${s}px Pretendard, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif`;
  g.fillStyle = "#19274d"; g.fillRect(0, 0, W, H);
  g.fillStyle = "#fff1df"; roundRect(g, 60, 60, W - 120, H - 120, 36); g.fill();
  g.strokeStyle = "#c49b75"; g.lineWidth = 8; roundRect(g, 60, 60, W - 120, H - 120, 36); g.stroke();
  g.fillStyle = "#19274d"; g.textAlign = "center";
  g.font = font(900, 58); g.fillText("🏛️ 결정국 판결문", W / 2, 180);
  g.font = font(700, 34); g.fillStyle = "#6b5a4b";
  wrap(g, `안건: ${rec.title}`, W / 2, 270, W - 220, 46, 2);
  g.fillStyle = "#ffe0a6"; roundRect(g, 140, 370, W - 280, 220, 28); g.fill();
  g.fillStyle = "#c23a2e"; g.font = font(800, 32); g.fillText(rec.label || "판결", W / 2, 430);
  g.fillStyle = "#19274d"; g.font = font(900, 80); wrap(g, rec.verdict, W / 2, 530, W - 320, 86, 1);
  g.save(); g.translate(W - 230, 600); g.rotate(-0.16);
  g.strokeStyle = "#c23a2e"; g.lineWidth = 9; roundRect(g, -110, -55, 220, 110, 14); g.stroke();
  g.fillStyle = "#c23a2e"; g.font = font(900, 64); g.fillText("결재", 0, 22); g.restore();
  if (rec.options && rec.counts) {
    const total = rec.counts.reduce((a, b) => a + b, 0) || 1;
    rec.options.slice(0, 6).forEach((o, i) => {
      const y = 680 + i * 52;
      g.textAlign = "left"; g.fillStyle = "#3b2f25"; g.font = font(800, 30);
      g.fillText(clip(g, (i === rec.winner ? "👑 " : "") + o, 300), 150, y);
      g.fillStyle = "#f0e1d1"; roundRect(g, 470, y - 24, 360, 26, 13); g.fill();
      g.fillStyle = i === rec.winner ? "#e57a1f" : "#c9a27a"; roundRect(g, 470, y - 24, Math.max(10, 360 * rec.counts[i] / total), 26, 13); g.fill();
      g.textAlign = "right"; g.fillStyle = "#3b2f25"; g.fillText(`${Number.isInteger(rec.counts[i]) ? rec.counts[i] : rec.counts[i].toFixed(1)}표`, 930, y);
    });
  }
  g.textAlign = "center"; g.fillStyle = "#8a7a6c"; g.font = font(700, 26);
  g.fillText(`${rec.date || today()} · 고민은 접수하고, 결정은 즐겁게!`, W / 2, H - 100);
  return c;
  function roundRect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
  function clip(ctx, t, max) { let s = String(t); while (ctx.measureText(s).width > max && s.length > 1) s = s.slice(0, -1); return s === String(t) ? s : s.slice(0, -1) + "…"; }
  function wrap(ctx, text, x, y, max, lh, lines) {
    const chars = [...String(text)]; let line = "", n = 0;
    for (const ch of chars) {
      if (ctx.measureText(line + ch).width > max) { if (++n >= lines) { ctx.fillText(clip(ctx, line + "…", max), x, y); return; } ctx.fillText(line, x, y); y += lh; line = ch; }
      else line += ch;
    }
    ctx.fillText(line, x, y);
  }
}

function openShare(rec) {
  openModal("📤 판결문 공유", `
    <div class="share-preview"><img id="share-img" alt="판결문 이미지 미리보기" /></div>
    <p class="hint">공유하면 안건 제목과 판결이 다른 사람에게 보입니다. 개인적인 내용이 담겨 있다면 공유 전에 확인해 주세요.</p>
    <p class="ok" id="share-ok" role="status" hidden></p>
    <div class="btn-row three">
      <button class="primary secondary" id="share-copy">📋 문구 복사</button>
      <button class="primary secondary" id="share-save">🖼️ 이미지 저장</button>
      ${navigator.share ? `<button class="primary" id="share-native">📤 공유하기</button>` : ""}
    </div>`, () => {
      const canvas = drawVerdictImage(rec);
      document.getElementById("share-img").src = canvas.toDataURL("image/png");
      const ok = msg => { const el = document.getElementById("share-ok"); el.textContent = msg; el.hidden = false; };
      document.getElementById("share-copy").onclick = async () => {
        try { await navigator.clipboard.writeText(verdictText(rec)); ok("판결문 문구를 복사했어요. 원하는 곳에 붙여 넣으세요!"); }
        catch { ok("복사하지 못했어요. 브라우저 권한을 확인해 주세요."); }
      };
      document.getElementById("share-save").onclick = () => {
        canvas.toBlob(blob => {
          const a = document.createElement("a");
          a.href = URL.createObjectURL(blob); a.download = "결정국-판결문.png";
          document.body.appendChild(a); a.click(); a.remove();
          setTimeout(() => URL.revokeObjectURL(a.href), 2000);
          ok("이미지를 저장했어요.");
        }, "image/png");
      };
      const nat = document.getElementById("share-native");
      if (nat) nat.onclick = () => {
        canvas.toBlob(async blob => {
          const file = new File([blob], "결정국-판결문.png", { type: "image/png" });
          const data = navigator.canShare && navigator.canShare({ files: [file] })
            ? { files: [file], text: verdictText(rec) } : { title: "결정국 판결문", text: verdictText(rec) };
          try { await navigator.share(data); } catch {}
        }, "image/png");
      };
    });
}

let recordFilter = { cat: "전체", q: "" };
async function showRecords() {
  const { records, source, error } = await loadRecords();
  const mode = source === "server"
    ? `<p class="hint">🔒 ${escapeHTML(currentUser.email || "")} 계정의 기록입니다. 다른 사람은 볼 수 없어요.</p>`
    : `<p class="hint">🧪 체험 모드: 이 브라우저에만 저장됩니다. <button type="button" class="link-btn" id="rec-login">로그인</button>하면 계정에 저장돼요.</p>`;
  const wire = () => { const b = document.getElementById("rec-login"); if (b) b.onclick = () => openLogin(); };
  if (error) { openModal("📜 결정 기록실", mode + `<p class="err">${escapeHTML(dbMessage(error))}</p>`, wire); return; }
  if (!records.length) {
    openModal("📜 결정 기록실", mode + `<div class="empty"><div class="empty-faces"><img class="owl" src="assets/owl.png" alt="서기관 부엉이" />${userFace()}</div>아직 저장된 결정이 없습니다.<br>고민을 접수하고 첫 결정을 만들어 보세요!<br><button class="primary" id="rec-start">고민 접수하기</button></div>`, () => { wire(); document.getElementById("rec-start").onclick = () => startMeeting(); });
    return;
  }
  const cats = ["전체", ...[...CATEGORIES, ...Object.keys(LEGACY_CATEGORY)].filter(c => records.some(r => r.category === c))];
  if (!cats.includes(recordFilter.cat)) recordFilter.cat = "전체";
  openModal("📜 결정 기록실", mode + `
    <div class="rec-tools">
      <input id="rec-q" type="search" maxlength="50" placeholder="🔍 제목·판결로 찾기" value="${escapeHTML(recordFilter.q)}" aria-label="기록 검색" />
      <div class="chip-row" role="group" aria-label="유형 필터">${cats.map(c => `<button type="button" class="chip" data-rcat="${c}" aria-pressed="${c === recordFilter.cat}">${c === "전체" ? "전체" : categoryIcon(c) + " " + c}</button>`).join("")}</div>
    </div>
    <p class="err" id="rec-err" role="alert" hidden></p>
    <p class="hint" id="rec-count"></p>
    <div id="all-records">
      ${records.map((item, index) => `
        <details class="record-detail" data-idx="${index}">
          <summary class="list-action">
            <span>${escapeHTML(item.icon || "📌")}</span>
            <span class="record-title">${escapeHTML(item.title)}</span>
            <span class="record-date">${escapeHTML(item.date || "")}</span>
            <span class="verdict-pill">${escapeHTML(item.verdict)}</span>
          </summary>
          <div class="record-body">
            <div class="hint">${escapeHTML(item.category || "")}${item.label ? " · " + escapeHTML(item.label) : ""}${item.tally ? " · " + escapeHTML(item.tally) : ""}${item.retrial ? " · 재심" : ""}</div>
            ${(item.evidence || []).length ? `<div class="ev-rec">${item.evidence.map(e => `<div>${e.ok ? "📎" : "⚠️"} <b>${escapeHTML(e.label)}</b> ${escapeHTML(e.summary)}${e.source ? ` <small>(${escapeHTML(e.source)}${e.fetchedAt ? ", " + escapeHTML(hhmm(e.fetchedAt)) + " 조회" : ""})</small>` : ""}</div>`).join("")}</div>` : ""}
            ${(item.moves || []).length ? `<div class="ev-rec">${item.moves.map(v => `<div>🔁 ${escapeHTML(v.name)}: ${escapeHTML(v.from)} → ${escapeHTML(v.to)}</div>`).join("")}</div>` : ""}
            ${(item.opinions || []).map(([n, t]) => `<div class="opinion small"><strong>${escapeHTML(n)}</strong>${escapeHTML(t)}</div>`).join("")}
            <div class="btn-row slim">
              <button class="chip" data-share="${index}">📤 판결문 공유</button>
              <button class="chip" data-again="${index}">♟️ 다시 회의</button>
              <button class="delete-btn" data-delete="${index}">이 기록 삭제</button>
            </div>
          </div>
        </details>`).join("")}
    </div>`, () => {
      wire();
      const apply = () => {
        const q = recordFilter.q.trim().toLowerCase(); let shown = 0;
        modalRoot.querySelectorAll(".record-detail").forEach(el => {
          const r = records[Number(el.dataset.idx)];
          const ok = (recordFilter.cat === "전체" || r.category === recordFilter.cat) && (!q || (r.title + " " + r.verdict).toLowerCase().includes(q));
          el.hidden = !ok; if (ok) shown++;
        });
        document.getElementById("rec-count").textContent = `${shown}건 / 전체 ${records.length}건`;
      };
      document.getElementById("rec-q").oninput = e => { recordFilter.q = e.target.value; apply(); };
      modalRoot.querySelectorAll("[data-rcat]").forEach(b => b.onclick = () => {
        recordFilter.cat = b.dataset.rcat;
        modalRoot.querySelectorAll("[data-rcat]").forEach(x => x.setAttribute("aria-pressed", String(x === b)));
        apply();
      });
      apply();
      modalRoot.querySelectorAll("[data-share]").forEach(b => b.onclick = () => openShare(records[Number(b.dataset.share)]));
      modalRoot.querySelectorAll("[data-again]").forEach(b => b.onclick = () => {
        const r = records[Number(b.dataset.again)];
        meeting = newMeeting(r.title); meeting.category = currentCategory(r.category);
        const real = (r.options || []).filter(o => !["한다", "안 한다", "하지 않기", "구매 승인", "하루 더 생각하기", "보류"].includes(o));
        if (real.length >= 2) meeting.rawOptions = real.slice(0, LIMITS.optionsMax);
        renderAgenda();
      });
      modalRoot.querySelectorAll("[data-delete]").forEach(button => {
        button.onclick = async () => {
          button.disabled = true;
          const index = Number(button.dataset.delete);
          const res = await removeRecord(records[index], index);
          if (!res.ok) { button.disabled = false; return showError("rec-err", dbMessage(res.error) || "삭제하지 못했어요."); }
          showRecent();
          showRecords();
        };
      });
    });
}

document.querySelectorAll(".category").forEach(button => {
  button.onclick = () => {
    document.querySelectorAll(".category").forEach(item => item.classList.remove("selected"));
    button.classList.add("selected");
    selectedCategory = button.dataset.category;
  };
});

document.getElementById("quick-form").onsubmit = event => {
  event.preventDefault();
  startMeeting(document.getElementById("quick-title").value.trim());
};

// ===== 이런 고민도 접수해 보세요 (누르면 내용이 채워진 채 국무회의 시작) =====
const EXAMPLES = [
  { icon: "🍴", title: "오늘 저녁 뭐 먹지?", category: "맛집", options: ["마라탕", "김치찌개", "샐러드"] },
  { icon: "✈️", title: "이번 주말 어디 갈까?", category: "나들이", options: ["한강 피크닉", "전시회", "집에서 쉬기"], tags: ["out", "in", "in"] },
  { icon: "🛍️", title: "새 이어폰 살까?", category: "쇼핑", options: [] },
  { icon: "🎮", title: "오늘 밤 게임 할까, 일찍 잘까?", category: "일상", options: ["게임 한 판", "일찍 자기"] },
  { icon: "📌", title: "운동 시작할까?", category: "일상", options: [] }
];
function renderExamples() {
  const box = document.getElementById("example-list");
  if (!box) return;
  box.innerHTML = EXAMPLES.map((e, i) => `
    <button type="button" class="example-item" data-example="${i}">
      <span class="pop-icon">${e.icon}</span>
      <span><span class="pop-title">${escapeHTML(e.title)}</span><span class="pop-sub">${e.options.length ? escapeHTML(e.options.join(" · ")) : e.category === "쇼핑" ? "구매 재판" : "할까 말까"}</span></span>
      <span class="pop-go">접수 ›</span>
    </button>`).join("");
  box.querySelectorAll("[data-example]").forEach(b => b.onclick = () => {
    const e = EXAMPLES[Number(b.dataset.example)];
    meeting = newMeeting(e.title);
    meeting.category = e.category;
    if (e.options.length) { meeting.rawOptions = e.options.slice(); meeting.rawTags = (e.tags || e.options.map(() => null)).slice(); }
    renderAgenda();
  });
}

// ===== 내 결정 통계 (내 기록으로만 계산) =====
function pickOf(text) { const m = /^「(.+?)」 — /.exec(String(text)); return m ? m[1] : null; }
async function openStats() {
  const { records, source } = await loadRecords();
  const scope = source === "server" ? `🔒 ${escapeHTML(currentUser.email || "")} 계정 기준` : "🧪 체험 모드: 이 브라우저 기록 기준";
  if (!records.length) {
    openModal("📊 내 결정 통계", `<p class="hint">${scope}</p><div class="empty"><img class="owl" src="assets/owl.png" alt="" /><br>아직 통계를 낼 기록이 없어요.<br>고민을 몇 개 접수하면 장관별 승률을 보여 드릴게요!</div>`);
    return;
  }
  const wins = Object.fromEntries(MINISTERS.map(x => [x.name, 0]));
  const votes = Object.fromEntries(MINISTERS.map(x => [x.name, 0]));
  const prio = {}, cats = {};
  let unanimous = 0, retrials = 0;
  records.forEach(rec => {
    const win = String(rec.verdict || "").replace(/!$/, "");
    (rec.opinions || []).forEach(([name, text]) => {
      const p = pickOf(text);
      if (p && name in votes) { votes[name]++; if (p === win) wins[name]++; }
    });
    if (rec.priority) prio[rec.priority] = (prio[rec.priority] || 0) + 1;
    cats[rec.category] = (cats[rec.category] || 0) + 1;
    if (rec.label === "만장일치") unanimous++;
    if (rec.retrial) retrials++;
  });
  const rate = n => votes[n] ? Math.round(wins[n] / votes[n] * 100) : 0;
  const ranked = MINISTERS.slice().sort((a, b) => rate(b.name) - rate(a.name) || wins[b.name] - wins[a.name]);
  const topPrio = Object.entries(prio).sort((a, b) => b[1] - a[1])[0];
  const topCat = Object.entries(cats).sort((a, b) => b[1] - a[1])[0];
  openModal("📊 내 결정 통계", `
    <p class="hint">${scope} · 기록 ${records.length}건</p>
    <div class="stat-grid">
      <div class="stat"><b>${records.length}</b><span>내린 결정</span></div>
      <div class="stat"><b>${unanimous}</b><span>만장일치</span></div>
      <div class="stat"><b>${retrials}</b><span>재심 청구</span></div>
      <div class="stat"><b>${topCat ? categoryIcon(topCat[0]) : "-"}</b><span>${topCat ? escapeHTML(topCat[0]) + " 고민이 가장 많아요" : ""}</span></div>
    </div>
    <h3 class="sub-h">🏆 장관별 내 판결 적중률</h3>
    <p class="hint">장관이 던진 표가 최종 판결과 같았던 비율입니다. 높을수록 그 장관의 생각이 내 결정과 닮았어요.</p>
    <div class="tally">
      ${ranked.map((x, i) => `
        <div class="tally-row ${i === 0 && votes[x.name] ? "win" : ""}">
          <span class="tally-name">${x.emoji} ${x.name}</span>
          <span class="bar"><span style="width:${rate(x.name)}%"></span></span>
          <span class="tally-num">${rate(x.name)}%</span>
        </div>`).join("")}
    </div>
    ${topPrio ? `<p class="stat-note">내가 가장 자주 고른 기준은 <b>${PRIORITY_LABEL[topPrio[0]]}</b>(${topPrio[1]}회)이에요.</p>` : ""}`);
}

// ===== 계정: 비밀번호 재설정 · 새 비밀번호 · 회원 탈퇴 =====
function openReset() {
  openModal("🔑 비밀번호 재설정", `
    <form id="reset-form" novalidate>
      <div class="field"><label for="reset-email">가입한 이메일</label><input id="reset-email" type="email" autocomplete="email" maxlength="254" /></div>
      <p class="err" id="reset-err" role="alert" hidden></p>
      <p class="ok" id="reset-ok" role="status" hidden></p>
      <button class="primary" type="submit" id="reset-btn">재설정 메일 보내기</button>
    </form>
    <p class="hint">가입 여부와 관계없이 같은 안내가 표시됩니다(다른 사람의 가입 여부를 알아낼 수 없도록).</p>`, () => {
      document.getElementById("reset-form").onsubmit = async e => {
        e.preventDefault();
        const email = document.getElementById("reset-email").value.trim();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return showError("reset-err", "이메일 형식을 확인해 주세요.");
        const btn = document.getElementById("reset-btn"); btn.disabled = true;
        const { error } = await db.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
        btn.disabled = false;
        if (error && /rate|too many/i.test(error.message || "")) return showError("reset-err", authMessage(error));
        showError("reset-err", "");
        const ok = document.getElementById("reset-ok"); ok.hidden = false;
        ok.textContent = "입력한 이메일로 가입되어 있다면 재설정 링크를 보냈어요. 메일함(스팸함 포함)을 확인해 주세요.";
      };
    });
}

function openNewPassword() {
  openModal("🔑 새 비밀번호 설정", `
    <form id="newpw-form" novalidate>
      <div class="field"><label for="newpw">새 비밀번호</label><input id="newpw" type="password" autocomplete="new-password" minlength="8" maxlength="72" />
        <div class="hint">8자 이상, 영문과 숫자를 섞어 주세요.</div></div>
      <p class="err" id="newpw-err" role="alert" hidden></p>
      <button class="primary" type="submit">비밀번호 바꾸기</button>
    </form>`, () => {
      document.getElementById("newpw-form").onsubmit = async e => {
        e.preventDefault();
        const pw = document.getElementById("newpw").value;
        if (pw.length < 8 || !(/[A-Za-z]/.test(pw) && /\d/.test(pw))) return showError("newpw-err", "8자 이상, 영문과 숫자를 함께 넣어 주세요.");
        const { error } = await db.auth.updateUser({ password: pw });
        if (error) return showError("newpw-err", authMessage(error));
        openModal("🔑 새 비밀번호 설정", `<p class="ok">비밀번호를 바꿨어요. 이제 새 비밀번호로 로그인할 수 있어요.</p>`);
      };
    });
}

function openDeleteAccount() {
  openModal("⚠️ 회원 탈퇴", `
    <p>탈퇴하면 <b>계정과 모든 결정 기록, 내 캐릭터 설정이 즉시 삭제</b>되며 되돌릴 수 없습니다.</p>
    <div class="field"><label for="del-confirm">확인을 위해 <b>탈퇴</b>라고 입력해 주세요.</label><input id="del-confirm" autocomplete="off" maxlength="10" /></div>
    <p class="err" id="del-err" role="alert" hidden></p>
    <div class="btn-row">
      <button class="primary secondary" id="del-cancel">취소</button>
      <button class="primary danger" id="del-go">탈퇴하기</button>
    </div>`, () => {
      document.getElementById("del-cancel").onclick = openAccount;
      document.getElementById("del-go").onclick = async () => {
        if (document.getElementById("del-confirm").value.trim() !== "탈퇴") return showError("del-err", "「탈퇴」라고 정확히 입력해 주세요.");
        const btn = document.getElementById("del-go"); btn.disabled = true; btn.textContent = "처리 중…";
        const { error } = await db.rpc("delete_my_account");
        if (error) { btn.disabled = false; btn.textContent = "탈퇴하기"; return showError("del-err", "탈퇴를 처리하지 못했어요. 잠시 후 다시 시도해 주세요."); }
        await db.auth.signOut({ scope: "local" }).catch(() => {});
        currentUser = null; profileAvatar = ""; applyAvatar(); showRecent();
        openModal("👋 탈퇴 완료", `<p>계정과 기록을 모두 삭제했어요. 그동안 결정국을 이용해 주셔서 감사합니다.</p>`);
      };
    });
}

const AVATARS = [
  ["grandpa", "할아버지"], ["grandma", "할머니"], ["man30", "직장인"], ["woman30", "직장인"], ["teen_boy", "음악 소년"],
  ["teen_girl", "카메라 소녀"], ["student", "학생"], ["skater", "스케이트"], ["woman40", "커피 한 잔"], ["man50", "골프"]
];
const AVATAR_KEY = "decision-country-avatar";
function getAvatar() {
  if (currentUser) return profileAvatar;
  try { const v = localStorage.getItem(AVATAR_KEY); return AVATARS.some(a => a[0] === v) ? v : ""; } catch { return ""; }
}
function applyAvatar() {
  const btn = document.querySelector(".login-btn"); const id = getAvatar();
  if (!btn) return;
  const label = currentUser ? "내 계정" : "로그인";
  btn.innerHTML = id ? `<img src="assets/people/person_${id}.png" alt="">${label}` : `👤 ${label}`;
}
applyAvatar();
// ===== 📮 국민 여론 광장 =====
// 보기: 누구나(합계만 공개하는 poll_board 함수). 글쓰기·투표·신고: 로그인 사용자만.
// 1인 1표·마감·선택지 범위·하루 5개 제한·신고 3건 숨김은 모두 DB(제약·트리거·RLS)가 강제한다.
const POLL_DURATIONS = [[1, "1시간"], [24, "하루"], [72, "3일"], [168, "7일"]];
let pollFilter = "open";
function pollLeft(iso) {
  const ms = new Date(iso) - Date.now();
  if (ms <= 0) return "마감";
  const h = Math.floor(ms / 3600e3), m = Math.floor(ms % 3600e3 / 60e3);
  return h >= 24 ? `${Math.floor(h / 24)}일 ${h % 24}시간 남음` : h ? `${h}시간 ${m}분 남음` : `${Math.max(m, 1)}분 남음`;
}
function pollError(error) {
  const msg = String((error && (error.message || error.code)) || "");
  const known = ["로그인이 필요해요", "하루에 5개", "마감된 여론조사", "없는 선택지", "투표할 수 없는", "내 글은 신고할 수 없어요"].find(k => msg.includes(k));
  if (known) return msg.replace(/^.*?(여론조사는|로그인|마감|없는|투표할|내 글)/, "$1");
  if (/duplicate|23505/.test(msg)) return "이미 참여했어요.";
  return dbMessage(error);
}
async function loadPolls() {
  if (!db) return { polls: [], error: { message: "서버가 연결되지 않았어요" } };
  const { data, error } = await db.rpc("poll_board", { p_limit: 60 });
  return { polls: Array.isArray(data) ? data : [], error };
}
function pollCard(p) {
  const opts = Array.isArray(p.options) ? p.options.map(String) : [];
  const counts = Array.isArray(p.counts) ? p.counts.map(Number) : opts.map(() => 0);
  const total = Number(p.total) || 0;
  const voted = p.my_vote !== null && p.my_vote !== undefined;
  const showResult = voted || !p.is_open || p.mine || !currentUser;
  const max = Math.max(...counts, 0);
  const body = showResult
    ? `<div class="tally">${opts.map((o, i) => {
        const pct = total ? Math.round(counts[i] / total * 100) : 0;
        return `<div class="tally-row ${total && counts[i] === max && !p.is_open ? "win" : ""}">
          <span class="tally-name">${voted && Number(p.my_vote) === i ? "✔ " : ""}${escapeHTML(o)}</span>
          <span class="bar"><span style="width:${pct}%"></span></span><span>${counts[i]}표 · ${pct}%</span></div>`;
      }).join("")}</div>`
    : `<div class="chip-row poll-vote" role="group" aria-label="선택지">${opts.map((o, i) =>
        `<button type="button" class="chip" data-vote="${escapeHTML(p.id)}" data-opt="${i}">${escapeHTML(o)}</button>`).join("")}</div>
       <div class="hint">투표하면 결과가 보여요. 한 번 투표하면 바꿀 수 없어요.</div>`;
  return `<article class="poll-card ${p.is_open ? "" : "closed"}">
    <div class="poll-head">
      <span class="poll-cat">${categoryIcon(p.category)}</span>
      <b class="poll-title">${escapeHTML(p.title)}</b>
      <span class="poll-left ${p.is_open ? "" : "done"}">${p.is_open ? "⏳ " + pollLeft(p.closes_at) : "🔒 마감"}</span>
    </div>
    ${body}
    <div class="poll-foot">
      <span>참여 ${total}명${p.mine ? " · ✍️ 내가 올린 글" : ""}${voted ? " · 투표 완료" : ""}</span>
      ${p.mine ? `<button type="button" class="link-btn" data-pdel="${escapeHTML(p.id)}">삭제</button>`
        : currentUser && !p.reported ? `<button type="button" class="link-btn" data-preport="${escapeHTML(p.id)}">🚩 신고</button>`
        : p.reported ? `<span class="hint">신고함</span>` : ""}
    </div>
  </article>`;
}
async function openPolls() {
  openModal("📮 국민 여론 광장", `<div class="empty">여론을 모으는 중…</div>`);
  const { polls, error } = await loadPolls();
  if (!modalRoot.querySelector(".modal")) return;
  const open = polls.filter(p => p.is_open), closed = polls.filter(p => !p.is_open);
  const list = pollFilter === "open" ? open : closed;
  const body = modalRoot.querySelector(".modal-body");
  body.innerHTML = `
    <p class="poll-intro">고민을 올리면 다른 시민들이 투표해 줘요. 장관 판결과 국민 여론을 비교해 보세요!</p>
    <div class="poll-top">
      <div class="chip-row" role="group" aria-label="보기">
        <button type="button" class="chip" data-pf="open" aria-pressed="${pollFilter === "open"}">⏳ 진행 중 ${open.length}</button>
        <button type="button" class="chip" data-pf="closed" aria-pressed="${pollFilter === "closed"}">🔒 마감 ${closed.length}</button>
      </div>
      <button type="button" class="primary" id="poll-new">✍️ 여론조사 올리기</button>
    </div>
    ${currentUser ? "" : `<div class="info-box">👀 지금은 결과만 볼 수 있어요. <b>투표·글쓰기</b>는 로그인한 시민만 할 수 있어요. <button type="button" class="link-btn" id="poll-login">로그인하기</button></div>`}
    ${error ? `<div class="form-error">여론을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.</div>` : ""}
    <div id="poll-msg" class="form-error" role="alert"></div>
    <div class="poll-list">${list.length ? list.map(pollCard).join("") : `<div class="empty">${pollFilter === "open" ? "진행 중인 여론조사가 없어요. 첫 고민을 올려 보세요!" : "마감된 여론조사가 없어요."}</div>`}</div>
    <div class="notice">공개 게시판입니다. 이름·연락처·주소 같은 개인정보는 적지 마세요. 작성자와 투표자는 공개되지 않고 표 합계만 보여요. 신고가 3건 쌓이면 자동으로 숨겨져요.</div>`;
  const msg = text => { const el = document.getElementById("poll-msg"); if (el) el.textContent = text; };
  body.querySelectorAll("[data-pf]").forEach(b => b.onclick = () => { pollFilter = b.dataset.pf; openPolls(); });
  document.getElementById("poll-new").onclick = () => openPollForm();
  const lg = document.getElementById("poll-login"); if (lg) lg.onclick = () => openLogin();
  body.querySelectorAll("[data-vote]").forEach(b => b.onclick = async () => {
    body.querySelectorAll(`[data-vote="${CSS.escape(b.dataset.vote)}"]`).forEach(x => x.disabled = true);
    const { error: e } = await db.from("poll_votes").insert({ poll_id: b.dataset.vote, option_index: Number(b.dataset.opt) });
    if (e) { msg("투표하지 못했어요. " + pollError(e)); body.querySelectorAll(`[data-vote="${CSS.escape(b.dataset.vote)}"]`).forEach(x => x.disabled = false); return; }
    openPolls();
  });
  body.querySelectorAll("[data-preport]").forEach(b => b.onclick = async () => {
    if (!confirm("이 여론조사를 신고할까요? 욕설·개인정보·광고처럼 부적절한 글만 신고해 주세요.")) return;
    const { error: e } = await db.from("poll_reports").insert({ poll_id: b.dataset.preport });
    if (e) return msg("신고하지 못했어요. " + pollError(e));
    openPolls();
  });
  body.querySelectorAll("[data-pdel]").forEach(b => b.onclick = async () => {
    if (!confirm("내 여론조사를 삭제할까요? 받은 표도 함께 지워져요.")) return;
    const { data, error: e } = await db.from("polls").delete().eq("id", b.dataset.pdel).select("id");
    if (e || !data || !data.length) return msg("삭제하지 못했어요. " + pollError(e));
    openPolls();
  });
}
function openPollForm(prefill = {}) {
  if (!db) return openModal("✍️ 여론조사 올리기", `<p>서버가 연결되지 않았어요.</p>`);
  if (!currentUser) return openLogin("login", "여론조사를 올리려면 로그인해 주세요.");
  const opts = (prefill.options && prefill.options.length >= 2 ? prefill.options : ["", ""]).slice(0, LIMITS.optionsMax);
  const cat = CATEGORIES.includes(prefill.category) ? prefill.category : "일상";
  openModal("✍️ 여론조사 올리기", `
    <form id="poll-form" novalidate>
      <div class="field"><label for="poll-title">고민 제목</label>
        <input id="poll-title" maxlength="100" autocomplete="off" value="${escapeHTML(prefill.title || "")}" placeholder="예) 오늘 저녁 뭐 먹지?" /></div>
      <div class="field"><label>고민 유형</label>
        <div class="chip-row" role="group" aria-label="고민 유형">${CATEGORIES.map(c => `<button type="button" class="chip" data-pcat="${c}" aria-pressed="${c === cat}">${categoryIcon(c)} ${c}</button>`).join("")}</div></div>
      <div class="field"><label>선택지 <small>(2~6개, 각 40자 이내)</small></label>
        <div id="poll-opts">${opts.map((o, i) => `<input class="opt-input poll-opt" maxlength="40" autocomplete="off" value="${escapeHTML(o)}" placeholder="선택지 ${i + 1}" aria-label="선택지 ${i + 1}" />`).join("")}</div>
        <button type="button" class="link-btn" id="poll-add">＋ 선택지 추가</button></div>
      <div class="field"><label>투표 기간</label>
        <div class="chip-row" role="group" aria-label="투표 기간">${POLL_DURATIONS.map(([h, t]) => `<button type="button" class="chip" data-pdur="${h}" aria-pressed="${h === 24}">${t}</button>`).join("")}</div></div>
      <div class="notice">누구나 볼 수 있는 공개 글이에요. 이름·연락처·주소 같은 개인정보는 적지 마세요. 올린 뒤에는 수정할 수 없고 삭제만 할 수 있어요.</div>
      <div id="poll-form-err" class="form-error" role="alert"></div>
      <div class="btn-row"><button type="button" class="primary secondary" id="poll-back">◀ 목록</button><button type="submit" class="primary">📮 여론조사 올리기</button></div>
    </form>`, () => {
      let category = cat, hours = 24;
      const form = document.getElementById("poll-form"), err = document.getElementById("poll-form-err");
      form.querySelectorAll("[data-pcat]").forEach(b => b.onclick = () => { category = b.dataset.pcat; form.querySelectorAll("[data-pcat]").forEach(x => x.setAttribute("aria-pressed", String(x === b))); });
      form.querySelectorAll("[data-pdur]").forEach(b => b.onclick = () => { hours = Number(b.dataset.pdur); form.querySelectorAll("[data-pdur]").forEach(x => x.setAttribute("aria-pressed", String(x === b))); });
      document.getElementById("poll-add").onclick = () => {
        const box = document.getElementById("poll-opts");
        if (box.children.length >= LIMITS.optionsMax) { err.textContent = `선택지는 최대 ${LIMITS.optionsMax}개예요.`; return; }
        box.insertAdjacentHTML("beforeend", `<input class="opt-input poll-opt" maxlength="40" autocomplete="off" placeholder="선택지 ${box.children.length + 1}" aria-label="선택지 ${box.children.length + 1}" />`);
      };
      document.getElementById("poll-back").onclick = openPolls;
      form.onsubmit = async event => {
        event.preventDefault();
        const title = document.getElementById("poll-title").value.trim();
        const options = [...form.querySelectorAll(".poll-opt")].map(i => i.value.trim()).filter(Boolean);
        if (!title) return (err.textContent = "고민 제목을 적어 주세요.");
        if (title.length > 100) return (err.textContent = "제목은 100자 이내로 적어 주세요.");
        if (options.length < 2) return (err.textContent = "선택지를 2개 이상 적어 주세요.");
        if (options.some(o => o.length > 40)) return (err.textContent = "선택지는 40자 이내로 적어 주세요.");
        if (new Set(options).size !== options.length) return (err.textContent = "같은 선택지가 두 번 있어요.");
        err.textContent = "올리는 중…";
        form.querySelector('button[type="submit"]').disabled = true;
        // 작성자·작성 시각·마감 시각은 보내지 않는다. DB가 로그인 정보와 서버 시각으로 정한다.
        const { error } = await db.from("polls").insert({ title, category, options, duration_hours: hours });
        if (error) { err.textContent = "올리지 못했어요. " + pollError(error); form.querySelector('button[type="submit"]').disabled = false; return; }
        pollFilter = "open";
        openPolls();
      };
    });
}

document.querySelectorAll("[data-action]").forEach(button => {
  button.addEventListener("click", () => {
    const action = button.dataset.action;
    if (action === "home") window.scrollTo({ top: 0, behavior: "smooth" });
    if (action === "meeting") startMeeting();
    if (action === "records") showRecords();
    if (action === "stats") openStats();
    if (action === "polls") openPolls();
    if (action === "share") loadRecords().then(({ records }) => records[0] ? openShare(records[0])
      : openModal("📤 판결문 공유", `<p>아직 공유할 판결이 없어요. 먼저 고민을 접수해 보세요!</p><button class="primary" id="share-start">고민 접수하기</button>`, () => { document.getElementById("share-start").onclick = () => startMeeting(); }));
    if (action === "settings") openModal("⚙️ 설정", `
      <div class="field"><label>기록 관리</label><p class="hint">${currentUser ? "결정 기록은 로그인한 계정에 저장되며, 본인만 보고 지울 수 있습니다." : "체험 모드: 결정 기록은 이 브라우저에만 보관되며 서버로 전송되지 않습니다. 로그인하면 계정에 저장됩니다."}</p></div>
      <div class="field"><label>내 캐릭터 고르기</label>
        <p class="hint">${currentUser ? "선택한 캐릭터는 내 계정에 저장됩니다." : "체험 모드에서는 이 브라우저에만 저장됩니다."}</p>
        <p class="err" id="set-err" role="alert" hidden></p>
        <div class="avatar-grid">${AVATARS.map(a => `<button type="button" class="avatar-opt" data-avatar="${a[0]}" aria-pressed="${getAvatar() === a[0]}" title="${a[1]}"><img src="assets/people/person_${a[0]}.png" alt="${a[1]}"></button>`).join("")}</div></div>
      <button class="delete-btn" id="clear-records">저장된 기록 모두 삭제</button>`, () => {
        modalRoot.querySelectorAll("[data-avatar]").forEach(b => b.onclick = async () => {
          const res = await setAvatar(b.dataset.avatar);
          if (!res.ok) return showError("set-err", dbMessage(res.error));
          modalRoot.querySelectorAll("[data-avatar]").forEach(x => x.setAttribute("aria-pressed", String(x === b)));
          applyAvatar();
        });
        document.getElementById("clear-records").onclick = async () => {
          const res = await clearRecords();
          if (!res.ok) return showError("set-err", dbMessage(res.error));
          showRecent();
          closeModal();
        };
      });
    if (action === "login") { if (currentUser) openAccount(); else openLogin(); }
    if (action === "reconsider") {
      loadRecords().then(({ records }) => startMeeting(records[0] ? records[0].title : ""));
    }
  });
});


// 배경 이미지(1264x842) 위에 말풍선·이름표를 같은 자리에 덮어 그린다. (이미지 속 말풍선 글자 오타 대체)
const SCENE_W = 1264, SCENE_H = 842;
const VIEW_TOP = 138, VIEW_ROWS = 495, DESK_TOP = 140, DESK_ROWS = 300; // 화면에 보여 줄 그림 구간(국무총리 말풍선~관객)
const SCENE_ITEMS = [
  { x: 618,  y: 236, w: 112, h: 54, text: "신중하게 검토해야 합니다!", chip: [706, 414, "신중주의"] },
  { x: 744,  y: 246, w: 108, h: 46, text: "재미도 중요합니다!",         chip: [820, 402, "낭만주의"] },
  { x: 852,  y: 148, w: 172, h: 50, text: "지금부터 국무회의를 시작하겠습니다!", chip: [938, 340, "국무총리"] },
  { x: 1022, y: 233, w: 116, h: 50, text: "예산도 따져 봅시다!",         chip: [1060, 402, "현실주의"] },
  { x: 1155, y: 262, w: 94,  h: 46, text: "일단 해봅시다!",             chip: [1186, 414, "행동파"] }
];
function layoutScene() {
  const box = document.getElementById("hero-art");
  const img = document.getElementById("scene-img");
  if (!box || !img) return;
  const narrow = window.matchMedia("(max-width: 1000px)").matches;
  const phone = window.matchMedia("(max-width: 600px)").matches;
  const w = box.clientWidth;
  const hero = box.parentElement;
  let scale, offsetX, yTop = VIEW_TOP;
  if (narrow) {
    // 태블릿·폰: 너비에 맞춰 그림 구간을 통째로 보여 준다(폰은 오른쪽 62%만)
    const base = phone ? w / (SCENE_W * 0.62) : w / SCENE_W;
    box.style.height = Math.round(VIEW_ROWS * base) + "px";
    hero.style.minHeight = "";
    scale = base;
    offsetX = Math.max(0, SCENE_W * scale - w) * (phone ? 1 : 0.5);
  } else {
    // 데스크톱: 글자·접수 칸은 왼쪽, 장면은 오른쪽에 붙인다. 장관들이 접수 칸 쪽으로 다가오도록 조금만 키우되,
    // 말풍선~관객 머리(최소 380행)는 항상 보이게 확대 한도를 둔다.
    box.style.height = "";
    hero.style.minHeight = "";
    const h = box.clientHeight;
    const copy = hero.querySelector(".hero-copy");
    const boxLeft = box.getBoundingClientRect().left;
    const copyRight = copy ? copy.getBoundingClientRect().right - boxLeft : w * 0.4;
    const free = Math.max(200, w - copyRight - 30);
    scale = Math.max(h / VIEW_ROWS, Math.min(free / (SCENE_W - 590), h / 380));
    const rows = h / scale;
    yTop = Math.max(0, Math.min(SCENE_H - rows, 138)); // 국무총리 말풍선이 잘리지 않게 위쪽 기준
    offsetX = SCENE_W * scale - w; // 오른쪽 정렬
  }
  const imgW = SCENE_W * scale, imgH = SCENE_H * scale;
  img.style.width = imgW + "px"; img.style.height = imgH + "px";
  img.style.left = (-offsetX) + "px"; img.style.top = (-yTop * scale) + "px";
  img.style.webkitMaskImage = img.style.maskImage = narrow ? "none" : "linear-gradient(90deg, transparent 0, rgba(0,0,0,.4) 22%, #000 40%)";
  box.querySelectorAll(".sbubble, .schip").forEach(el => el.remove());
  const fs = Math.max(phone ? 7 : 11, Math.round(10.5 * scale));
  SCENE_ITEMS.forEach(item => {
    const bub = document.createElement("div");
    bub.className = "sbubble";
    bub.style.cssText = `left:${item.x * scale - offsetX}px;top:${(item.y - yTop) * scale}px;width:${item.w * scale}px;height:${(item.h - 6) * scale}px;font-size:${fs}px`;
    bub.innerHTML = `<div class="body"></div><div class="tail"></div>`;
    bub.firstChild.textContent = item.text;
    box.appendChild(bub);
    const [cx, cy, name] = item.chip;
    const c = document.createElement("div");
    c.className = "schip";
    c.style.cssText = `left:${cx * scale - offsetX}px;top:${(cy - yTop) * scale}px;font-size:${Math.max(phone ? 7 : 10, Math.round(10 * scale))}px`;
    c.textContent = name;
    box.appendChild(c);
  });
}
window.addEventListener("resize", layoutScene);
window.addEventListener("load", layoutScene);
if (document.fonts && document.fonts.ready) document.fonts.ready.then(layoutScene);
if (window.ResizeObserver) new ResizeObserver(layoutScene).observe(document.querySelector(".hero"));
layoutScene();

renderExamples();
showRecent();
if (db) {
  db.auth.getSession().then(({ data }) => onAuthChanged(data.session));
  db.auth.onAuthStateChange((event, session) => {
    if (event === "INITIAL_SESSION") return;
    if (event === "PASSWORD_RECOVERY") setTimeout(openNewPassword, 0);
    setTimeout(() => onAuthChanged(session), 0); // 콜백 안에서 바로 DB를 부르지 않도록 다음 틱에 처리
  });
}
