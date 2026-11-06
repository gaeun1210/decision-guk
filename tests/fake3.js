(function () {
  const S = window.__S = { user: null, polls: [], votes: [], reports: [], decisions: [], profiles: [] };
  const users = { "a@test.com": { id: "uid-A", email: "a@test.com" }, "b@test.com": { id: "uid-B", email: "b@test.com" } };
  const cbs = [];
  const err = m => ({ data: null, error: { message: m } });
  function board() {
    const u = S.user && S.user.id, now = Date.now();
    return S.polls.filter(p => !p.hidden || p.user_id === u).map(p => {
      const vs = S.votes.filter(v => v.poll_id === p.id);
      const mv = vs.find(v => v.user_id === u);
      return { id: p.id, title: p.title, category: p.category, options: p.options, created_at: p.created_at, closes_at: p.closes_at,
        is_open: Date.parse(p.closes_at) > now, counts: p.options.map((_, i) => vs.filter(v => v.option_index === i).length), total: vs.length,
        mine: u ? p.user_id === u : null, my_vote: mv ? mv.option_index : null, reported: S.reports.some(r => r.poll_id === p.id && r.user_id === u), minister_pick: Number.isInteger(p.minister_pick) ? p.minister_pick : null };
    });
  }
  function q(table) {
    const st = { op: "select", f: [], payload: null };
    const run = () => {
      const u = S.user && S.user.id;
      if (table === "decisions" || table === "profiles") {
        if (st.op === "insert") {
          if (S.failInsert > 0) { S.failInsert--; return err("Failed to fetch"); }
          if (st.payload.id && S.decisions.some(d => d.id === st.payload.id)) return { data: null, error: { code: "23505", message: "duplicate key value" } };
          S.decisions.push(st.payload); return { data: null, error: null };
        }
        return { data: table === "profiles" ? null : [], error: null };
      }
      if (!u) return err("permission denied for table " + table);
      if (table === "polls" && st.op === "insert") {
        const p = st.payload;
        if (!Array.isArray(p.options) || p.options.length < 2) return err("violates check constraint");
        if (S.polls.filter(x => x.user_id === u).length >= 5) return err("여론조사는 하루에 5개까지 올릴 수 있어요");
        S.polls.push({ ...p, id: "poll-" + (S.polls.length + 1), user_id: u, created_at: new Date().toISOString(), closes_at: new Date(Date.now() + p.duration_hours * 3600e3).toISOString(), hidden: false });
        return { data: null, error: null };
      }
      if (table === "polls" && st.op === "delete") {
        const del = S.polls.filter(p => p.user_id === u && st.f.every(([k, v]) => p[k] === v));
        S.polls = S.polls.filter(p => !del.includes(p)); return { data: del.map(p => ({ id: p.id })), error: null };
      }
      if (table === "poll_votes" && st.op === "insert") {
        if (S.votes.some(v => v.poll_id === st.payload.poll_id && v.user_id === u)) return err('duplicate key value violates unique constraint "poll_votes_pkey"');
        S.votes.push({ ...st.payload, user_id: u }); return { data: null, error: null };
      }
      if (table === "poll_reports" && st.op === "insert") {
        const p = S.polls.find(x => x.id === st.payload.poll_id);
        if (p.user_id === u) return err("내 글은 신고할 수 없어요");
        S.reports.push({ ...st.payload, user_id: u }); S.lastReport = st.payload;
        if (S.reports.filter(r => r.poll_id === p.id).length >= 3) p.hidden = true;
        return { data: null, error: null };
      }
      return { data: [], error: null };
    };
    const b = { select() { return b; }, order() { return b; }, limit() { return b; }, eq(k, v) { st.f.push([k, v]); return b; }, maybeSingle() { return b; }, upsert() { return b; },
      insert(p) { st.op = "insert"; st.payload = p; return b; }, delete() { st.op = "delete"; return b; },
      then(res, rej) { return Promise.resolve(run()).then(res, rej); } };
    return b;
  }
  window.supabase = { createClient() { return {
    from: q,
    rpc: async (name) => name === "poll_board" ? (S.failBoard ? { data: null, error: { message: "Failed to fetch" } } : { data: board(), error: null }) : { data: null, error: { message: "no" } },
    auth: {
      getSession: async () => ({ data: { session: S.user ? { user: S.user } : null } }),
      onAuthStateChange(cb) { cbs.push(cb); return { data: { subscription: { unsubscribe() {} } } }; },
      async signInWithPassword({ email, password }) { if (!users[email] || password !== "secret12a") return { error: { message: "Invalid login credentials" } }; S.user = users[email]; cbs.forEach(c => c("SIGNED_IN", { user: S.user })); return { data: { user: S.user }, error: null }; },
      async signOut() { S.user = null; cbs.forEach(c => c("SIGNED_OUT", null)); return { error: null }; },
      async signUp() { return { data: {}, error: null }; }, async resetPasswordForEmail() { return { error: null }; }, async updateUser() { return { error: null }; }
    } }; } };
})();
