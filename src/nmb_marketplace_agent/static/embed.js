/* NMB Agent chat widget. Usage:
   <script src="https://YOUR-HOST/embed.js" data-key="pk_..." data-title="Support"
           data-color="#2f5cff" data-greeting="Hi! How can I help?"
           data-suggestions='["Check my balance","Report a lost card"]'
           data-theme='{"accent":"#0f766e","mode":"system","radius":16}'
           data-config='{"USER_JWT":"eyJ..."}'></script>
   JS API: NMB.open() NMB.close() NMB.send(text) NMB.identify(userId) NMB.reset()
           NMB.config(key, value) / NMB.config({KEY: "value"})
             - key/value config sent with every message (page -> tools), e.g. a
               customer JWT. Secrets stay in memory and are never shown in the chat.
           NMB.theme({accent, accentInk, surface, text, muted, mode, radius})
           NMB.suggest(["Ask one", "Ask two"])
           NMB.tool(name, handler, {auto?, title?, describe?, applyLabel?, declineLabel?})
             - run a frontend tool on this page and resume the run; auto tools
               (product lists, navigation, lookups) run without a confirmation.
           NMB.ui(name, render)
             - render(args, result) returns an element shown in the chat, e.g.
               a horizontal product-card strip or a navigation card. Without a
               renderer, any list result still shows as a card strip (click a
               card for its full record).
           NMB.el(tag, attrs, kids) - small DOM helper for renderers.
           Header: ☰ opens thread history, ＋ starts a new chat.
           Renderer classes: .gen-h (title), .gen-cards (horizontal scroller),
             .gen-card / .gen-card-img / .gen-card-b / .gen-card-s (clickable
             card with optional image), .gen-list (vertical rows), .gen-price,
             .gen-row, .gen-total, .gen-foot, .gen-actions, .gen-chip. */
(function () {
  var s = document.currentScript;
  if (!s || !s.dataset.key) { console.error("[NMB] data-key is required"); return; }
  var key = s.dataset.key, api = s.dataset.api || new URL(s.src).origin;
  var title = s.dataset.title || "Chat", color = s.dataset.color || "#2f5cff";
  var greeting = s.dataset.greeting || "Hi! How can I help?";
  var themeState = {};       // resolved theme (accent, accentInk, surface, text, muted, mode, radius)
  var themeUser = false;     // theme chosen by the page — server defaults must not override it
  var suggestions = parseList(s.dataset.suggestions);
  var cfg = parseConfig(s.dataset.config);  // page -> backend key/value config (never stored)
  var LS = "nmb_" + key.slice(0, 10) + "_";
  var get = function (k) { try { return localStorage.getItem(LS + k); } catch (e) { return null; } };
  var put = function (k, v) { try { localStorage.setItem(LS + k, v); } catch (e) {} };
  var rid = function () { return (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now(); };

  var uid = get("uid") || ("u_" + rid()); put("uid", uid);
  var thread = get("thread") || null;
  var hist = []; try { hist = JSON.parse(get("hist") || "[]"); } catch (e) {}
  var busy = false;
  var session = null;  // short-lived token exchanged from the key via /v1/session
  var sources = [];    // citations emitted for the current reply
  var handoff = null;  // open human handoff, or null
  var seen = {};       // handoff message ids already rendered
  var poll = null;     // staff-reply polling timer
  var paused = [];     // frontend-tool interrupts the page owes an answer
  var tools = {};      // NMB.tool(name, handler, opts) - page actions, opt. auto-run
  var views = {};      // NMB.ui(name, render) - generative UI for a tool's result

  var host = document.createElement("div");
  document.body.appendChild(host);
  var root = host.attachShadow({ mode: "open" });
  root.innerHTML =
    '<style>' +
    ':host{all:initial;--nmb-accent:' + color + ';--nmb-accent-ink:#fff;--nmb-surface:#fff;--nmb-text:#14171c;' +
    '--nmb-muted:#f6f7f9;--nmb-line:#e3e6eb;--nmb-soft:#cfd4dc;--nmb-dim:#667085;--nmb-radius:14px}' +
    '*{box-sizing:border-box;font:14px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif}' +
    '.fab{position:fixed;right:20px;bottom:20px;width:56px;height:56px;border-radius:50%;border:0;background:var(--nmb-accent);color:var(--nmb-accent-ink);font-size:24px;cursor:pointer;box-shadow:0 6px 20px rgba(0,0,0,.25);z-index:2147483000}' +
    '.panel{position:fixed;right:20px;bottom:88px;width:360px;max-width:calc(100vw - 24px);height:520px;max-height:calc(100vh - 110px);display:none;flex-direction:column;background:var(--nmb-surface);color:var(--nmb-text);border-radius:var(--nmb-radius);box-shadow:0 10px 40px rgba(0,0,0,.28);overflow:hidden;z-index:2147483000}' +
    '.panel.open{display:flex}' +
    '.hd{background:var(--nmb-accent);color:var(--nmb-accent-ink);padding:12px 14px;font-weight:600;display:flex;justify-content:space-between;align-items:center}' +
    '.hd button{background:none;border:0;color:var(--nmb-accent-ink);font-size:18px;cursor:pointer}' +
    '.hd .h{font-size:12px;font-weight:500;opacity:.9;padding:2px 4px}' +
    '.hd .h:disabled{opacity:.5;cursor:default}' +
    '.msgs{flex:1;overflow:auto;padding:12px;display:flex;flex-direction:column;gap:8px;background:var(--nmb-muted)}' +
    '.m{max-width:85%;padding:8px 11px;border-radius:12px;white-space:pre-wrap;word-break:break-word}' +
    '.user{align-self:flex-end;background:var(--nmb-accent);color:var(--nmb-accent-ink)}' +
    '.bot{align-self:flex-start;background:var(--nmb-surface);border:1px solid var(--nmb-line)}' +
    '.staff{align-self:flex-start;background:#eefbf3;border:1px solid #b7e4c7;color:#134e2c}' +
    '.sys{align-self:center;font-size:11px;color:var(--nmb-dim);text-align:center}' +
    '.typing{opacity:.6;font-style:italic}' +
    '.src{margin-top:6px;padding-top:6px;border-top:1px solid var(--nmb-line);font-size:11px;opacity:.75}' +
    '.fb{align-self:flex-start;margin-top:-4px;font-size:12px;color:var(--nmb-dim)}.fb button{background:none;border:0;cursor:pointer;font-size:14px}' +
    '.hd .ic{background:none;border:0;color:var(--nmb-accent-ink);font-size:15px;cursor:pointer;padding:2px 4px;opacity:.92}' +
    '.hd .ic:hover{opacity:1}' +
    '.hist{position:absolute;inset:0;background:var(--nmb-surface);color:var(--nmb-text);z-index:5;display:none;flex-direction:column}' +
    '.hist.open{display:flex}' +
    '.hist-h{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:10px 12px;border-bottom:1px solid var(--nmb-line)}' +
    '.hist-h b{font-size:13px}' +
    '.hist-new{border:1px solid var(--nmb-soft);background:var(--nmb-surface);color:var(--nmb-text);border-radius:8px;padding:4px 9px;font-size:12px;cursor:pointer}' +
    '.hist-actions{display:flex;align-items:center;gap:6px}' +
    '.hist-x{background:none;border:0;color:var(--nmb-dim);font-size:15px;cursor:pointer;padding:2px 4px}' +
    '.hist-list{flex:1;overflow:auto;padding:6px}' +
    '.hist-row{display:flex;flex-direction:column;align-items:flex-start;width:100%;text-align:left;background:none;border:0;border-radius:8px;padding:8px 10px;cursor:pointer;font:inherit;color:inherit}' +
    '.hist-row:hover{background:var(--nmb-muted)}.hist-row[data-active]{background:var(--nmb-muted);outline:1px solid var(--nmb-soft)}' +
    '.hist-t{font-size:12.5px;font-weight:600;color:var(--nmb-text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}' +
    '.hist-d{font-size:11px;color:var(--nmb-dim);margin-top:1px}' +
    '.hist-empty{padding:18px 12px;text-align:center;font-size:12px;color:var(--nmb-dim)}' +
    '.dtl{position:fixed;inset:0;background:rgba(15,23,42,.45);z-index:2147483001;display:none;align-items:center;justify-content:center;padding:16px}' +
    '.dtl.open{display:flex}' +
    '.dtl-card{width:320px;max-width:100%;max-height:80vh;overflow:auto;background:var(--nmb-surface);color:var(--nmb-text);border-radius:12px;box-shadow:0 12px 40px rgba(0,0,0,.3)}' +
    '.dtl-h{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:10px 12px;border-bottom:1px solid var(--nmb-line);font-size:13px}' +
    '.dtl-h button{background:none;border:0;font-size:16px;cursor:pointer;color:var(--nmb-dim)}' +
    '.dtl-body{padding:10px 12px;font-size:12.5px}' +
    '.dtl-img{width:100%;height:140px;object-fit:cover;border-radius:8px;background:var(--nmb-muted);margin-bottom:8px}' +
    '.dtl-row{display:flex;justify-content:space-between;gap:12px;padding:4px 0;border-top:1px solid var(--nmb-line)}' +
    '.dtl-row:first-child{border-top:0}' +
    '.dtl-row span{color:var(--nmb-dim)}' +
    '.dtl-row b{font-weight:600;text-align:right;word-break:break-word}' +
    '.act{align-self:stretch;max-width:96%;background:var(--nmb-surface);border:1px solid #f0c36d;border-radius:12px;padding:9px 11px}' +
    '.act-h{font-weight:700;font-size:12.5px;color:#8a5a00}' +
    '.act-d{margin-top:2px;font-size:12.5px;color:var(--nmb-dim)}' +
    '.act-row{display:flex;gap:8px;margin-top:8px}' +
    '.act-row button{border:1px solid var(--nmb-soft);background:var(--nmb-surface);color:var(--nmb-text);border-radius:8px;padding:5px 10px;font-size:12px;cursor:pointer}' +
    '.act-row button:disabled{opacity:.5;cursor:default}' +
    '.act-row .act-yes{background:var(--nmb-accent);border-color:var(--nmb-accent);color:var(--nmb-accent-ink);font-weight:600}' +
    '.act.done{border-color:#d0e6d5}.act.done .act-row{display:none}' +
    '.prog{align-self:stretch;max-width:96%;background:var(--nmb-surface);border:1px solid var(--nmb-line);border-radius:12px;padding:9px 11px}' +
    '.prog-h{font-weight:600;font-size:12.5px;margin-bottom:6px}' +
    '.prog-row{display:flex;align-items:center;gap:8px;font-size:12.5px;color:var(--nmb-dim);padding:2px 0}' +
    '.prog-row[data-state="run"]{color:var(--nmb-text)}' +
    '.prog-dot{width:8px;height:8px;border-radius:50%;background:var(--nmb-soft);flex:0 0 auto}' +
    '.prog-row[data-state="run"] .prog-dot{background:var(--nmb-accent);animation:nmbpulse 1s ease-in-out infinite}' +
    '.prog-row[data-state="done"] .prog-dot{background:#16a34a}' +
    '@keyframes nmbpulse{0%,100%{opacity:.35;transform:scale(.8)}50%{opacity:1;transform:scale(1)}}' +
    '.chips{display:flex;flex-wrap:wrap;gap:6px;padding:0 12px 10px;background:var(--nmb-muted)}' +
    '.chips[hidden]{display:none}' +
    '.chip{border:1px solid var(--nmb-soft);background:var(--nmb-surface);color:var(--nmb-text);border-radius:999px;padding:5px 10px;font-size:12px;cursor:pointer;text-align:left}' +
    '.chip:hover{border-color:var(--nmb-accent);color:var(--nmb-accent)}' +
    '.gen{align-self:stretch;max-width:96%;background:var(--nmb-surface);border:1px solid var(--nmb-line);border-radius:12px;padding:10px 11px}' +
    '.gen-h{font-weight:700;font-size:12.5px;margin-bottom:6px}' +
    '.gen-list{display:flex;flex-direction:column;gap:6px;max-height:240px;overflow-y:auto;padding-right:2px}' +
    '.gen-cards{display:flex;flex-direction:row;gap:8px;overflow-x:auto;overflow-y:hidden;padding-bottom:4px;scroll-snap-type:x proximity;-webkit-overflow-scrolling:touch}' +
    '.gen-cards::-webkit-scrollbar{height:6px}.gen-cards::-webkit-scrollbar-thumb{background:var(--nmb-soft);border-radius:3px}' +
    '.gen-card{flex:0 0 144px;scroll-snap-align:start;display:flex;flex-direction:column;align-items:stretch;text-align:left;font:inherit;color:inherit;background:var(--nmb-surface);border:1px solid var(--nmb-line);border-radius:9px;padding:6px;cursor:pointer;overflow:hidden}' +
    '.gen-card:hover{border-color:var(--nmb-soft)}.gen-card:focus-visible{outline:2px solid var(--nmb-accent);outline-offset:1px}' +
    '.gen-card-img{display:block;width:100%;height:78px;object-fit:cover;border-radius:6px;background:var(--nmb-muted);margin-bottom:5px}' +
    '.gen-card-b{display:block;font-weight:600;font-size:12px;line-height:1.25;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
    '.gen-card-s{display:block;color:var(--nmb-dim);font-size:10.5px;margin-top:1px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
    '.gen-card .gen-price{display:block;margin-top:4px;font-size:11.5px;font-weight:600}' +
    '.gen-item{display:flex;justify-content:space-between;gap:10px;border:1px solid var(--nmb-line);border-radius:8px;padding:7px 9px;font-size:12.5px}' +
    '.gen-item b{display:block;font-weight:600}' +
    '.gen-item span{display:block;color:var(--nmb-dim);font-size:11px;margin-top:1px}' +
    '.gen-price{white-space:nowrap;font-variant-numeric:tabular-nums}' +
    '.gen-row{display:flex;justify-content:space-between;gap:10px;font-size:12.5px;padding:2px 0}' +
    '.gen-row span{color:var(--nmb-dim)}' +
    '.gen-total{display:flex;justify-content:space-between;font-weight:700;border-top:1px solid var(--nmb-line);margin-top:5px;padding-top:6px;font-size:12.5px}' +
    '.gen-foot{margin-top:6px;font-size:11px;color:var(--nmb-dim)}' +
    '.gen-actions{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}' +
    '.gen-actions button{border:1px solid var(--nmb-soft);background:var(--nmb-surface);color:var(--nmb-text);border-radius:7px;padding:4px 9px;font-size:12px;cursor:pointer}' +
    '.gen-actions button:hover{border-color:var(--nmb-accent)}' +
    '.gen-chip{display:inline-block;border-radius:999px;padding:1px 8px;font-size:11px;font-weight:600;background:#e7fffb;color:#115e59}' +
    '.gen-chip.bad{background:#fef2f2;color:#991b1b}' +
    '.ft{display:flex;gap:8px;padding:10px;border-top:1px solid var(--nmb-line);background:var(--nmb-surface)}' +
    'textarea{flex:1;resize:none;height:40px;padding:8px 10px;border:1px solid var(--nmb-soft);border-radius:10px;color:var(--nmb-text);background:var(--nmb-surface)}' +
    '.send{border:0;background:var(--nmb-accent);color:var(--nmb-accent-ink);border-radius:10px;padding:0 14px;cursor:pointer}' +
    '.send:disabled{opacity:.5}' +
    '</style>' +
    '<button class="fab" aria-label="Open chat">💬</button>' +
    '<div class="panel" role="dialog" aria-label="' + title.replace(/"/g, "") + '">' +
    '<div class="hd"><span class="t"></span><span>' +
    '<button class="h" aria-label="Talk to a human">Talk to a human</button>' +
    '<button class="ic l" aria-label="Chat history" title="Chat history">☰</button>' +
    '<button class="ic n" aria-label="New chat" title="New chat">＋</button>' +
    '<button class="x" aria-label="Close">✕</button></span></div>' +
    '<div class="msgs"></div>' +
    '<div class="chips" hidden></div>' +
    '<div class="ft"><textarea placeholder="Type a message…" rows="1"></textarea><button class="send">Send</button></div>' +
    '<div class="hist"><div class="hist-h"><b>Chats</b><span class="hist-actions">' +
    '<button class="hist-new" aria-label="New chat">＋ New chat</button>' +
    '<button class="hist-x" aria-label="Close history">✕</button></span></div>' +
    '<div class="hist-list"></div></div></div>' +
    '<div class="dtl"><div class="dtl-card"><div class="dtl-h"><b></b><button class="dtl-x" aria-label="Close">✕</button></div>' +
    '<div class="dtl-body"></div></div></div>';

  var $ = function (q) { return root.querySelector(q); };
  $(".t").textContent = title;
  var panel = $(".panel"), msgs = $(".msgs"), input = $("textarea"), sendBtn = $(".send");

  // ── theme, page config and starting suggestions ──────────────────
  function parseJSON(v) {
    if (!v) return null;
    if (typeof v === "object") return v;
    try { return JSON.parse(v); } catch (e) { return null; }
  }
  function putCfg(out, k, val) {
    k = String(k || "").trim();
    if (!k || val === null || val === undefined || val === "") return;
    out[k] = typeof val === "object" ? JSON.stringify(val) : String(val).trim();
  }
  function parseConfig(v) {
    var out = {};
    if (!v) return out;
    var j = parseJSON(v);
    if (j && typeof j === "object" && !Array.isArray(j)) {
      Object.keys(j).forEach(function (k) { putCfg(out, k, j[k]); });
      return out;
    }
    String(v).split(/[;\n]+/).forEach(function (pair) {
      var i = pair.indexOf("="); if (i < 0) i = pair.indexOf(":");
      if (i > 0) putCfg(out, pair.slice(0, i), pair.slice(i + 1));
    });
    return out;
  }
  function parseList(v) {
    var j = parseJSON(v);
    if (Array.isArray(j)) {
      return j.filter(function (x) { return typeof x === "string" && x.trim(); })
        .map(function (x) { return x.trim(); });
    }
    if (typeof v === "string") {
      return v.split(/\s*\|\s*|\n/).map(function (x) { return x.trim(); }).filter(Boolean);
    }
    return [];
  }

  function setTheme(t, byUser) {
    t = parseJSON(t);
    if (!t || typeof t !== "object" || Array.isArray(t)) return;
    if (byUser) themeUser = true;
    ["accent", "accentInk", "surface", "text", "muted"].forEach(function (k) {
      var v = t[k];
      if (typeof v === "string" && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v.trim())) themeState[k] = v.trim();
    });
    if (t.mode === "light" || t.mode === "dark" || t.mode === "system") themeState.mode = t.mode;
    var r = parseInt(t.radius, 10);
    if (!isNaN(r)) themeState.radius = Math.max(0, Math.min(28, r));
    applyTheme();
  }

  function applyTheme() {
    var dark = themeState.mode === "dark" ||
      (themeState.mode === "system" && window.matchMedia &&
       window.matchMedia("(prefers-color-scheme: dark)").matches);
    var vars = {
      "--nmb-accent": themeState.accent || color,
      "--nmb-accent-ink": themeState.accentInk || "#fff",
      "--nmb-surface": themeState.surface || (dark ? "#111827" : "#fff"),
      "--nmb-text": themeState.text || (dark ? "#e5e7eb" : "#14171c"),
      "--nmb-muted": themeState.muted || (dark ? "#0b1220" : "#f6f7f9"),
      "--nmb-line": dark ? "#273244" : "#e3e6eb",
      "--nmb-soft": dark ? "#3f4a5c" : "#cfd4dc",
      "--nmb-dim": dark ? "#9aa4b2" : "#667085",
      "--nmb-radius": (themeState.radius || 14) + "px"
    };
    Object.keys(vars).forEach(function (k) { host.style.setProperty(k, vars[k]); });
  }

  function renderChips() {
    var box = $(".chips"); if (!box) return;
    var hasUser = hist.some(function (h) { return h.r === "user"; });
    var texts = (!hasUser && !busy) ? suggestions.slice(0, 6) : [];
    box.innerHTML = "";
    box.hidden = !texts.length;
    texts.forEach(function (t) {
      var b = document.createElement("button");
      b.type = "button"; b.className = "chip"; b.textContent = t;
      b.onclick = function () { send(t); };
      box.appendChild(b);
    });
  }
  function hideChips() { var box = $(".chips"); if (box) box.hidden = true; }
  function suggest(list) { suggestions = parseList(list).slice(0, 6); renderChips(); }

  // Server-side wrapper defaults (theme + starting suggestions) for this key.
  var discovered = false;
  function discover() {
    if (discovered) return;
    token().then(function (tok) {
      return fetch(api + "/v1/agents", { headers: { Authorization: "Bearer " + tok } });
    }).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
      if (!d) return;
      discovered = true;
      var list = d.agents || [], agent = null;
      for (var i = 0; i < list.length; i++) { if (list[i].default) { agent = list[i]; break; } }
      agent = agent || list[0];
      var wrap = (agent && agent.wrapper) || {};
      if (!themeUser && wrap.theme) setTheme(wrap.theme, false);
      var extra = (agent && agent.suggestions) || [];
      extra.forEach(function (t) {
        if (typeof t === "string" && t && suggestions.indexOf(t) < 0) suggestions.push(t);
      });
      suggestions = suggestions.slice(0, 6);
      renderChips();
    }).catch(function () {});
  }

  function add(role, text) {
    var d = document.createElement("div");
    d.className = "m " + role; d.textContent = text;
    msgs.appendChild(d); msgs.scrollTop = msgs.scrollHeight;
    return d;
  }
  function save(role, text) {
    hist.push({ r: role, t: text }); hist = hist.slice(-30);
    put("hist", JSON.stringify(hist));
  }
  function open() { panel.classList.add("open"); renderChips(); input.focus(); }
  function close() { panel.classList.remove("open"); toggleHist(false); }

  function reset() {
    stopPolling();
    handoff = null; seen = {};
    paused = []; sources = []; busy = false;
    thread = null; hist = []; put("thread", ""); put("hist", "[]");
    msgs.innerHTML = ""; add("bot", greeting);
    handoffBar();
    renderChips();
    toggleHist(false);
    closeItem();
  }
  function identify(id) { uid = String(id); put("uid", uid); session = null; reset(); }

  // ── thread history ──────────────────────────────────────────────
  function toggleHist(force) {
    var h = $(".hist");
    var open = force !== undefined ? force : !h.classList.contains("open");
    h.classList.toggle("open", open);
    if (open) loadThreads();
  }

  function relTime(iso) {
    if (!iso) return "";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  }

  function loadThreads() {
    var list = $(".hist-list");
    list.innerHTML = "";
    var note = document.createElement("div"); note.className = "hist-empty";
    note.textContent = "Loading chats…";
    list.appendChild(note);
    token().then(function (tok) {
      return fetch(api + "/v1/threads?limit=20", { headers: { Authorization: "Bearer " + tok } });
    }).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
      list.innerHTML = "";
      var rows = (d && d.threads) || [];
      if (!rows.length) {
        var empty = document.createElement("div"); empty.className = "hist-empty";
        empty.textContent = "No chats yet. Send a message to start one.";
        list.appendChild(empty);
        return;
      }
      rows.forEach(function (t) {
        var row = document.createElement("button");
        row.type = "button"; row.className = "hist-row";
        if (t.id === thread) row.setAttribute("data-active", "1");
        var a = document.createElement("span"); a.className = "hist-t";
        a.textContent = t.title || "Untitled chat";
        var b = document.createElement("span"); b.className = "hist-d"; b.textContent = relTime(t.updated_at);
        row.appendChild(a); row.appendChild(b);
        row.onclick = function () { openThread(t.id); };
        list.appendChild(row);
      });
    }).catch(function () {
      list.innerHTML = "";
      var e = document.createElement("div"); e.className = "hist-empty";
      e.textContent = "Couldn't load your chats.";
      list.appendChild(e);
    });
  }

  function openThread(id) {
    if (busy || !id) return;
    toggleHist(false);
    token().then(function (tok) {
      return fetch(api + "/v1/threads/" + encodeURIComponent(id) + "/messages", {
        headers: { Authorization: "Bearer " + tok }
      });
    }).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
      if (!d) throw "Couldn't open that chat.";
      stopPolling(); handoff = null; handoffBar();
      seen = {}; paused = []; sources = [];
      thread = id; put("thread", thread);
      msgs.innerHTML = ""; hist = [];
      (d.messages || []).forEach(function (m) {
        var role = m.role === "user" ? "user" : "bot";
        add(role, m.text);
        hist.push({ r: role, t: m.text });
      });
      hist = hist.slice(-30); put("hist", JSON.stringify(hist));
      if (!hist.length) add("bot", greeting);
      renderChips();
    }).catch(function (e) {
      sysNote(typeof e === "string" ? e : "Couldn't open that chat.");
    });
  }

  function newChat() {
    if (busy) return;
    reset();
  }

  // ── human handoff ────────────────────────────────────────────────
  function sysNote(text) {
    var d = document.createElement("div"); d.className = "m sys"; d.textContent = text;
    msgs.appendChild(d); msgs.scrollTop = msgs.scrollHeight;
  }
  function stopPolling() { if (poll) { clearInterval(poll); poll = null; } }
  function startPolling() {
    if (poll) return;
    poll = setInterval(pollHandoff, 3000);
    pollHandoff();
  }
  function handoffBar() {
    var b = $(".h");
    if (handoff) { b.textContent = "Waiting for a colleague…"; b.disabled = true; }
    else { b.textContent = "Talk to a human"; b.disabled = false; }
  }
  function pollHandoff() {
    if (!handoff || !thread) { stopPolling(); return; }
    token().then(function (tok) {
      return fetch(api + "/v1/handoff/" + encodeURIComponent(thread), {
        headers: { Authorization: "Bearer " + tok }
      });
    }).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
      if (!d || !d.handoff) return;
      handoff = d.handoff;
      (d.messages || []).forEach(function (m) {
        if (seen[m.id] || m.role !== "staff") return;
        seen[m.id] = 1;
        add("staff", m.text);
        save("staff", m.text);
      });
      if (handoff.status === "resolved") {
        stopPolling(); handoff = null; handoffBar();
        sysNote("The human agent has finished. You can keep chatting with the assistant.");
      }
    }).catch(function () {});
  }
  function requestHuman() {
    if (!thread) {
      sysNote("Send a message first, then I can connect you to a colleague.");
      return;
    }
    if (handoff) { startPolling(); return; }
    token().then(function (tok) {
      return fetch(api + "/v1/handoff", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + tok },
        body: JSON.stringify({ thread_id: thread, user_id: uid })
      });
    }).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
      if (!d || !d.handoff) throw "Could not reach the team.";
      handoff = d.handoff; handoffBar();
      sysNote("Connecting you with a colleague. Keep writing here; they will reply in this chat.");
      startPolling();
    }).catch(function (e) {
      sysNote(typeof e === "string" ? e : "Could not reach the team. Please try again.");
    });
  }

  function token() {
    if (session && session.exp > Date.now() + 5000) return Promise.resolve(session.token);
    return fetch(api + "/v1/session", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + key },
      body: JSON.stringify({ user_id: uid })
    }).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
      if (d && d.token) {
        session = { token: d.token, exp: Date.now() + (d.expires_in || 900) * 1000 };
        return d.token;
      }
      return key;  // session endpoint unavailable: keep working with the key
    }).catch(function () { return key; });
  }

  // ── page tools ───────────────────────────────────────────────────
  // The graph pauses on a browser tool (set_filter and friends). The widget
  // shows a card, runs the handler the page registered with NMB.tool(), and
  // resumes the same run through POST /v1/chat/resume.
  function pagePending(ev) {
    return (ev.interrupts || []).map(function (it) {
      var v = (it && it.value) || {};
      var c = v.toolCall || v.tool_call || {};
      return { id: it.id || "", call: c.id || "", name: c.name || "", args: c.args || {} };
    }).filter(function (p) { return p.name; });
  }

  function describeArgs(p, opts) {
    try {
      var d = opts.describe ? opts.describe(p.args || {}) : "";
      if (typeof d === "string" && d.trim()) return d.trim();
    } catch (e) {}
    return "This action changes something on this page. Apply it?";
  }

  // Customers should see what is happening ("Checking the catalogue"), not the
  // tool's input. Each page tool can name its step with opts.progress.
  function toolLabel(name) {
    var d = tools[name] || {};
    var o = d.opts || {};
    return o.progress || o.title || pretty(name);
  }

  function progressCard() {
    var card = document.createElement("div"); card.className = "m prog";
    var head = document.createElement("div"); head.className = "prog-h";
    head.textContent = "Working on your request…";
    var list = document.createElement("div");
    card.appendChild(head); card.appendChild(list);
    msgs.appendChild(card); msgs.scrollTop = msgs.scrollHeight;
    var rows = {};
    function step(k, label, state) {
      var row = rows[k];
      if (!row) {
        row = document.createElement("div"); row.className = "prog-row";
        row.appendChild(document.createElement("span")).className = "prog-dot";
        row.appendChild(document.createElement("span")).className = "prog-t";
        rows[k] = row; list.appendChild(row);
      }
      row.setAttribute("data-state", state || "run");
      row.lastChild.textContent = label;
      msgs.scrollTop = msgs.scrollHeight;
    }
    return { step: step, remove: function () { card.remove(); } };
  }

  function showView(p, result) {
    var render = views[p.name];
    var node = null;
    if (render) {
      try { node = render(p.args || {}, result); } catch (e) { node = null; }
    }
    if (!node) node = listCards(result);
    if (!node) return;
    var wrap = document.createElement("div"); wrap.className = "gen";
    wrap.appendChild(node);
    msgs.appendChild(wrap); msgs.scrollTop = msgs.scrollHeight;
  }

  // ── generic list results ─────────────────────────────────────────
  // Any tool result that is a list (or wraps one under items/results/data…)
  // renders as a horizontal card strip, whether or not the page registered a
  // custom view. Clicking a card opens its full record.
  function listItems(value) {
    if (Array.isArray(value)) return value;
    if (!value || typeof value !== "object") return null;
    var keys = ["items", "results", "data", "rows", "records", "list"];
    for (var i = 0; i < keys.length; i++) {
      if (Array.isArray(value[keys[i]])) return value[keys[i]];
    }
    return null;
  }

  function pick(obj, keys) {
    if (!obj || typeof obj !== "object") return "";
    for (var i = 0; i < keys.length; i++) {
      var v = obj[keys[i]];
      if (typeof v === "string" && v) return v;
    }
    return "";
  }

  function itemImage(it) {
    var v = pick(it, ["image", "image_url", "imageUrl", "thumbnail", "thumbnail_url", "thumbnailUrl", "photo", "avatar", "img"]);
    return /^(https?:\/\/|data:image\/)/.test(v) ? v : "";
  }

  function itemName(it) {
    if (it === null || it === undefined) return "";
    if (typeof it !== "object") return String(it);
    var v = pick(it, ["name", "title", "label", "subject"]);
    return v || (it.id === undefined || it.id === null ? "" : String(it.id));
  }

  function itemSub(it) {
    return pick(it, ["brand", "category", "type", "subtitle", "description", "status"]);
  }

  function itemPrice(it) {
    if (!it || typeof it !== "object") return "";
    var v = it.price !== undefined ? it.price : it.amount !== undefined ? it.amount : it.cost;
    if (v === undefined || v === null || v === "") return "";
    var num = typeof v === "number" ? (Math.round(v * 100) / 100).toFixed(2) : String(v);
    return it.currency ? it.currency + " " + num : num;
  }

  function listCards(value) {
    var items = listItems(value);
    if (!items || !items.length) return null;
    var wrap = document.createElement("div");
    var head = document.createElement("div"); head.className = "gen-h";
    head.textContent = (!Array.isArray(value) && value && (value.title || value.label || value.heading)) || "Results";
    wrap.appendChild(head);
    var strip = document.createElement("div"); strip.className = "gen-cards";
    items.slice(0, 24).forEach(function (it) {
      var c = document.createElement("button");
      c.type = "button"; c.className = "gen-card";
      var img = itemImage(it);
      if (img) {
        var im = document.createElement("img");
        im.className = "gen-card-img"; im.alt = ""; im.loading = "lazy"; im.src = img;
        c.appendChild(im);
      }
      var n = document.createElement("span"); n.className = "gen-card-b";
      n.textContent = itemName(it) || "Item";
      c.appendChild(n);
      var sub = itemSub(it);
      if (sub) { var s2 = document.createElement("span"); s2.className = "gen-card-s"; s2.textContent = sub; c.appendChild(s2); }
      var price = itemPrice(it);
      if (price) { var p2 = document.createElement("span"); p2.className = "gen-price"; p2.textContent = price; c.appendChild(p2); }
      c.onclick = function () { openItem(it); };
      strip.appendChild(c);
    });
    wrap.appendChild(strip);
    return wrap;
  }

  function pretty(k) {
    var t = String(k).replace(/_/g, " ").trim();
    return t.charAt(0).toUpperCase() + t.slice(1);
  }

  function openItem(it) {
    $(".dtl-h b").textContent = itemName(it) || "Details";
    var body = $(".dtl-body"); body.innerHTML = "";
    var img = itemImage(it);
    if (img) {
      var im = document.createElement("img");
      im.className = "dtl-img"; im.alt = ""; im.src = img;
      body.appendChild(im);
    }
    if (!it || typeof it !== "object") {
      var p = document.createElement("div"); p.textContent = String(it === undefined ? "" : it);
      body.appendChild(p);
    } else {
      Object.keys(it).forEach(function (k) {
        var v = it[k];
        if (v === null || v === undefined || v === "") return;
        // The image is already shown above; don't dump its data/URL row.
        if (typeof v === "string" && /^(https?:\/\/|data:image\/)/.test(v) && /image|thumb|photo|avatar|img/i.test(k)) return;
        var row = document.createElement("div"); row.className = "dtl-row";
        var a = document.createElement("span"); a.textContent = pretty(k);
        var b = document.createElement("b");
        b.textContent = typeof v === "object" ? JSON.stringify(v) : String(v);
        row.appendChild(a); row.appendChild(b); body.appendChild(row);
      });
    }
    $(".dtl").classList.add("open");
  }

  function closeItem() { $(".dtl").classList.remove("open"); }

  function askPage(p) {
    var def = tools[p.name];
    var fn = def && (typeof def === "function" ? def : def.fn);
    var opts = (def && def.opts) || {};

    // Read-only views (product lists, navigation, lookups) run without a prompt.
    if (opts.auto) {
      return Promise.resolve().then(function () {
        if (!fn) throw new Error("No page handler is registered for " + p.name);
        return fn(p.args, p);
      }).then(function (res) {
        showView(p, res);
        return res === undefined ? { ok: true } : res;
      }, function (e) {
        return { ok: false, error: (e && e.message) || String(e) };
      });
    }

    return new Promise(function (resolve) {
      var card = document.createElement("div"); card.className = "act";
      var head = document.createElement("div"); head.className = "act-h";
      head.textContent = opts.title || ("Confirm this step");
      var desc = document.createElement("div"); desc.className = "act-d";
      desc.textContent = describeArgs(p, opts);
      var row = document.createElement("div"); row.className = "act-row";
      card.appendChild(head); card.appendChild(desc); card.appendChild(row);
      msgs.appendChild(card); msgs.scrollTop = msgs.scrollHeight;

      function done(text) { card.classList.add("done"); head.textContent = text; }

      if (!fn) {
        var wait = document.createElement("button");
        wait.textContent = "Nothing to run"; wait.disabled = true;
        row.appendChild(wait);
        done((opts.title || "This step") + " · the page has no handler");
        resolve({ ok: false, error: "No page handler is registered for " + p.name });
        return;
      }

      var no = document.createElement("button"); no.textContent = opts.declineLabel || "Ignore";
      var yes = document.createElement("button"); yes.className = "act-yes";
      yes.textContent = opts.applyLabel || "Apply";
      row.appendChild(no); row.appendChild(yes);
      yes.onclick = function () {
        yes.disabled = no.disabled = true; yes.textContent = opts.workingLabel || "Working…";
        Promise.resolve().then(function () { return fn(p.args, p); }).then(function (res) {
          done(opts.doneTitle || "Done");
          showView(p, res);
          resolve(res === undefined ? { ok: true } : res);
        }, function (e) {
          yes.disabled = no.disabled = false; yes.textContent = opts.applyLabel || "Apply";
          desc.textContent = (e && e.message) || String(e);
        });
      };
      no.onclick = function () {
        yes.disabled = no.disabled = true;
        done(opts.declineTitle || "Left unchanged");
        resolve({ ok: false, declined: true });
      };
    });
  }

  function resumeRun(results, onToken, onEvent) {
    var resume = {};
    results.forEach(function (r) {
      if (!r.p.id) return;
      if (r.p.call) { var m = {}; m[r.p.call] = r.value; resume[r.p.id] = m; }
      else resume[r.p.id] = r.value;
    });
    var body = { thread_id: thread, resume: resume, user_id: uid };
    if (Object.keys(cfg).length) body.config = cfg;
    return token().then(function (tok) {
      return fetch(api + "/v1/chat/resume", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + tok,
          Accept: "text/event-stream"
        },
        body: JSON.stringify(body)
      }).then(function (r) {
        if (r.status === 409) throw "This request is no longer waiting for the page.";
        if (r.status === 413) throw "The page result is too large to send.";
        if (!r.ok) throw "Something went wrong (" + r.status + "). Please try again.";
        if (!r.body || !r.body.getReader) {
          return r.text().then(function (raw) { return drain(raw, onToken, onEvent); });
        }
        return stream(r.body.getReader(), onToken, onEvent);
      });
    });
  }

  function finish(msg, q) {
    if (sources.length) {
      var src = document.createElement("div"); src.className = "src";
      src.textContent = "Sources: " + sources.map(function (x) {
        return "[" + (x.id || "") + "] " + x.title + (x.page ? " (p. " + x.page + ")" : "");
      }).join(" \u00b7 ");
      msg.appendChild(src);
    }
    save("bot", msg.textContent);
    if (q) addFeedback(q, msg.textContent);
  }

  function runPaused(q, list) {
    var results = [];
    var prog = progressCard();
    var chain = Promise.resolve();
    list.forEach(function (p, i) {
      prog.step("tool:" + i, toolLabel(p.name), "run");
      chain = chain.then(function () { return askPage(p); }).then(function (value) {
        prog.step("tool:" + i, toolLabel(p.name), "done");
        results.push({ p: p, value: value });
      });
    });
    return chain.then(function () {
      var msg = null;
      sources = []; paused = [];
      prog.step("write", "Writing the reply", "run");
      function onToken(full) {
        if (!msg) msg = add("bot", "");
        msg.textContent = full; msgs.scrollTop = msgs.scrollHeight;
      }
      function onEvent(ev) {
        if (ev.type === "interrupt") {
          pagePending(ev).forEach(function (p, i) {
            prog.step("next:" + i, toolLabel(p.name), "run");
          });
        }
      }
      return resumeRun(results, onToken, onEvent).then(function (out) {
        if (handoff) {
          if (msg) msg.remove();
          prog.remove();
          sysNote("Sent to the team. A colleague will reply here.");
          return;
        }
        if (paused.length) {
          if (out.reply) { if (!msg) msg = add("bot", ""); msg.textContent = out.reply; }
          else if (msg) msg.remove();
          prog.remove();
          var next = paused.slice(); paused = [];
          return runPaused(q, next);
        }
        if (!msg) msg = add("bot", "");
        prog.remove();
        msg.textContent = out.reply || "Page updated.";
        finish(msg, q);
      }, function (e) {
        if (msg) msg.remove();
        prog.remove();
        throw e;
      });
    });
  }

  function frame(block, onToken, reply, onEvent) {
    var data = [];
    block.split("\n").forEach(function (line) {
      if (line.indexOf("data:") === 0) data.push(line.slice(5).replace(/^ /, ""));
    });
    data = data.join("\n");
    if (!data) return { reply: reply, done: false };
    if (data === "[DONE]") return { reply: reply, done: true };
    var ev; try { ev = JSON.parse(data); } catch (e) { return { reply: reply, done: false }; }
    if (onEvent) { try { onEvent(ev); } catch (e) {} }
    if (ev.type === "thread" && ev.threadId) { thread = ev.threadId; put("thread", thread); }
    else if (ev.type === "token" && ev.text) { reply += ev.text; if (onToken) onToken(reply); }
    else if (ev.type === "sources" && ev.sources) { sources = ev.sources; }
    else if (ev.type === "interrupt" && ev.interrupts) {
      pagePending(ev).forEach(function (p) { paused.push(p); });
    }
    else if (ev.type === "handoff" && ev.handoff) {
      handoff = ev.handoff;
      if (ev.messageId) seen[ev.messageId] = 1;
      handoffBar();
      if (handoff.status === "resolved") { stopPolling(); handoff = null; handoffBar(); }
      else startPolling();
    }
    else if (ev.type === "error") throw ev.error || "Something went wrong. Please try again.";
    return { reply: reply, done: false };
  }

  function drain(raw, onToken, onEvent) {
    var reply = "";
    raw.split(/\r?\n\r?\n/).forEach(function (block) {
      reply = frame(block, onToken, reply, onEvent).reply;
    });
    return { reply: reply, interrupted: paused.length > 0 };
  }

  function stream(reader, onToken, onEvent) {
    var dec = new TextDecoder(), buf = "", reply = "";
    function pump() {
      return reader.read().then(function (res) {
        if (res.done) return { reply: reply, interrupted: paused.length > 0 };
        buf += dec.decode(res.value, { stream: true });
        var i;
        while ((i = buf.indexOf("\n\n")) >= 0) {
          var block = buf.slice(0, i); buf = buf.slice(i + 2);
          var r = frame(block, onToken, reply, onEvent); reply = r.reply;
          if (r.done) return { reply: reply, interrupted: paused.length > 0 };
        }
        return pump();
      });
    }
    return pump();
  }

  function chat(text, onToken, onEvent, retried) {
    var body = { message: text, thread_id: thread, user_id: uid };
    if (Object.keys(cfg).length) body.config = cfg;
    return token().then(function (tok) {
      return fetch(api + "/v1/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + tok,
          Accept: "text/event-stream"
        },
        body: JSON.stringify(body)
      }).then(function (r) {
        if (r.status === 404 && thread && !retried) {
          thread = null; put("thread", "");
          return chat(text, onToken, onEvent, true);
        }
        if (r.status === 429) throw "Too many messages. Please wait a moment.";
        if (!r.ok) throw "Something went wrong (" + r.status + "). Please try again.";
        if (!r.body || !r.body.getReader) {
          return r.text().then(function (raw) { return drain(raw, onToken, onEvent); });
        }
        return stream(r.body.getReader(), onToken, onEvent);
      });
    });
  }

  function addFeedback(q, a) {
    var f = document.createElement("div"); f.className = "fb";
    ["\uD83D\uDC4D", "\uD83D\uDC4E"].forEach(function (e, i) {
      var b = document.createElement("button"); b.textContent = e;
      b.onclick = function () {
        token().then(function (tok) {
          return fetch(api + "/v1/feedback", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + tok },
            body: JSON.stringify({ thread_id: thread, rating: i ? "down" : "up", user_message: q, reply: a, user_id: uid }) });
        }).catch(function () {});
        f.textContent = "Thanks for the feedback!";
      };
      f.appendChild(b);
    });
    msgs.appendChild(f); msgs.scrollTop = msgs.scrollHeight;
  }

  function send(text) {
    text = (text || "").trim();
    if (!text || busy) return;
    busy = true; sendBtn.disabled = true;
    add("user", text); save("user", text);
    renderChips();
    var prog = progressCard();
    prog.step("start", "Message received", "done");
    var pending = null;
    function bubble() { if (!pending) pending = add("bot", ""); return pending; }
    function onToken(full) {
      bubble().textContent = full;
      prog.step("write", "Writing the reply", "run");
      msgs.scrollTop = msgs.scrollHeight;
    }
    function onEvent(ev) {
      if (ev.type === "interrupt") {
        pagePending(ev).forEach(function (p, i) { prog.step("tool:" + i, toolLabel(p.name), "run"); });
      } else if (ev.type === "handoff") {
        prog.step("handoff", "Connecting you with a colleague", "run");
      }
    }
    sources = []; paused = [];
    chat(text, onToken, onEvent).then(function (out) {
      if (handoff) {
        if (pending) pending.remove();
        prog.remove();
        sysNote("Sent to the team. A colleague will reply here.");
        return;
      }
      if (out.interrupted) {
        prog.remove();
        if (pending) {
          if (out.reply) { pending.textContent = out.reply; save("bot", out.reply); }
          else pending.remove();
        } else if (out.reply) {
          add("bot", out.reply); save("bot", out.reply);
        }
        var list = paused.slice(); paused = [];
        return runPaused(text, list);
      }
      var msg = pending || add("bot", "");
      prog.remove();
      msg.textContent = out.reply || "(no response)";
      finish(msg, text);
    }).catch(function (e) {
      if (pending) pending.remove();
      prog.remove();
      add("bot", typeof e === "string" ? e : "Network error. Please try again.");
    }).then(function () { busy = false; sendBtn.disabled = false; });
  }

  $(".fab").onclick = function () { panel.classList.contains("open") ? close() : open(); };
  $(".x").onclick = close;
  $(".h").onclick = requestHuman;
  $(".l").onclick = function () { toggleHist(); };
  $(".n").onclick = newChat;
  $(".hist-new").onclick = newChat;
  $(".hist-x").onclick = function () { toggleHist(false); };
  $(".dtl-x").onclick = closeItem;
  $(".dtl").onclick = function (e) { if (e.target === $(".dtl")) closeItem(); };
  sendBtn.onclick = function () { var v = input.value; input.value = ""; send(v); };
  input.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendBtn.click(); }
  });

  if (hist.length) hist.forEach(function (h) { add(h.r === "user" ? "user" : h.r === "staff" ? "staff" : "bot", h.t); });
  else add("bot", greeting);

  var pageTheme = parseJSON(s.dataset.theme);
  applyTheme();
  if (pageTheme) setTheme(pageTheme, true);
  renderChips();
  discover();

  function config(a, b) {
    if (a && typeof a === "object") Object.keys(a).forEach(function (k) { putCfg(cfg, k, a[k]); });
    else if (a !== undefined) putCfg(cfg, a, b);
    return cfg;
  }

  function theme(t) { setTheme(t, true); }

  function tool(name, fn, opts) {
    if (typeof name === "function" && !fn) { fn = name; name = "set_filter"; }
    if (name && typeof fn === "function") tools[String(name)] = { fn: fn, opts: opts || {} };
  }

  function ui(name, render) {
    if (name && typeof render === "function") views[String(name)] = render;
  }

  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      var v = attrs[k];
      if (k === "text") n.textContent = v;
      else if (k === "class") n.className = v;
      else if (k.indexOf("on") === 0 && typeof v === "function") n.addEventListener(k.slice(2), v);
      else if (v !== null && v !== undefined) n.setAttribute(k, v);
    });
    (Array.isArray(kids) ? kids : kids !== undefined && kids !== null ? [kids] : []).forEach(function (c) {
      n.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    });
    return n;
  }

  window.NMB = { open: open, close: close, send: function (t) { open(); send(t); }, identify: identify, reset: reset,
    config: config, theme: theme, suggest: suggest, tool: tool, ui: ui, el: el };
})();