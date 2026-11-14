/* NMB Agent chat widget. Usage:
   <script src="https://YOUR-HOST/embed.js" data-key="pk_..." data-title="Support"
           data-color="#2f5cff" data-greeting="Hi! How can I help?"></script>
   JS API: NMB.open() NMB.close() NMB.send(text) NMB.identify(userId) NMB.reset()
           NMB.tool(name, handler, {auto?, title?, applyLabel?, declineLabel?})
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
    ':host{all:initial}*{box-sizing:border-box;font:14px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif}' +
    '.fab{position:fixed;right:20px;bottom:20px;width:56px;height:56px;border-radius:50%;border:0;background:' + color + ';color:#fff;font-size:24px;cursor:pointer;box-shadow:0 6px 20px rgba(0,0,0,.25);z-index:2147483000}' +
    '.panel{position:fixed;right:20px;bottom:88px;width:360px;max-width:calc(100vw - 24px);height:520px;max-height:calc(100vh - 110px);display:none;flex-direction:column;background:#fff;color:#14171c;border-radius:14px;box-shadow:0 10px 40px rgba(0,0,0,.28);overflow:hidden;z-index:2147483000}' +
    '.panel.open{display:flex}' +
    '.hd{background:' + color + ';color:#fff;padding:12px 14px;font-weight:600;display:flex;justify-content:space-between;align-items:center}' +
    '.hd button{background:none;border:0;color:#fff;font-size:18px;cursor:pointer}' +
    '.hd .h{font-size:12px;font-weight:500;opacity:.9;padding:2px 4px}' +
    '.hd .h:disabled{opacity:.5;cursor:default}' +
    '.msgs{flex:1;overflow:auto;padding:12px;display:flex;flex-direction:column;gap:8px;background:#f6f7f9}' +
    '.m{max-width:85%;padding:8px 11px;border-radius:12px;white-space:pre-wrap;word-break:break-word}' +
    '.user{align-self:flex-end;background:' + color + ';color:#fff}' +
    '.bot{align-self:flex-start;background:#fff;border:1px solid #e3e6eb}' +
    '.staff{align-self:flex-start;background:#eefbf3;border:1px solid #b7e4c7}' +
    '.sys{align-self:center;font-size:11px;color:#667085;text-align:center}' +
    '.typing{opacity:.6;font-style:italic}' +
    '.src{margin-top:6px;padding-top:6px;border-top:1px solid #e3e6eb;font-size:11px;opacity:.75}' +
    '.fb{align-self:flex-start;margin-top:-4px;font-size:12px;color:#667085}.fb button{background:none;border:0;cursor:pointer;font-size:14px}' +
    '.hd .ic{background:none;border:0;color:#fff;font-size:15px;cursor:pointer;padding:2px 4px;opacity:.92}' +
    '.hd .ic:hover{opacity:1}' +
    '.hist{position:absolute;inset:0;background:#fff;z-index:5;display:none;flex-direction:column}' +
    '.hist.open{display:flex}' +
    '.hist-h{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:10px 12px;border-bottom:1px solid #e3e6eb}' +
    '.hist-h b{font-size:13px}' +
    '.hist-new{border:1px solid #cfd4dc;background:#fff;color:#14171c;border-radius:8px;padding:4px 9px;font-size:12px;cursor:pointer}' +
    '.hist-actions{display:flex;align-items:center;gap:6px}' +
    '.hist-x{background:none;border:0;color:#667085;font-size:15px;cursor:pointer;padding:2px 4px}' +
    '.hist-list{flex:1;overflow:auto;padding:6px}' +
    '.hist-row{display:flex;flex-direction:column;align-items:flex-start;width:100%;text-align:left;background:none;border:0;border-radius:8px;padding:8px 10px;cursor:pointer;font:inherit}' +
    '.hist-row:hover{background:#f2f5f9}.hist-row[data-active]{background:#eef2ff}' +
    '.hist-t{font-size:12.5px;font-weight:600;color:#14171c;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}' +
    '.hist-d{font-size:11px;color:#667085;margin-top:1px}' +
    '.hist-empty{padding:18px 12px;text-align:center;font-size:12px;color:#667085}' +
    '.dtl{position:fixed;inset:0;background:rgba(15,23,42,.45);z-index:2147483001;display:none;align-items:center;justify-content:center;padding:16px}' +
    '.dtl.open{display:flex}' +
    '.dtl-card{width:320px;max-width:100%;max-height:80vh;overflow:auto;background:#fff;border-radius:12px;box-shadow:0 12px 40px rgba(0,0,0,.3)}' +
    '.dtl-h{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:10px 12px;border-bottom:1px solid #e3e6eb;font-size:13px}' +
    '.dtl-h button{background:none;border:0;font-size:16px;cursor:pointer;color:#667085}' +
    '.dtl-body{padding:10px 12px;font-size:12.5px}' +
    '.dtl-img{width:100%;height:140px;object-fit:cover;border-radius:8px;background:#f1f5f9;margin-bottom:8px}' +
    '.dtl-row{display:flex;justify-content:space-between;gap:12px;padding:4px 0;border-top:1px solid #f0f2f5}' +
    '.dtl-row:first-child{border-top:0}' +
    '.dtl-row span{color:#667085}' +
    '.dtl-row b{font-weight:600;text-align:right;word-break:break-word}' +
    '.act{align-self:stretch;max-width:96%;background:#fff;border:1px solid #f0c36d;border-radius:12px;padding:9px 11px}' +
    '.act-h{font-weight:700;font-size:12.5px;color:#8a5a00}' +
    '.act-d{margin-top:2px;font-size:12.5px;color:#475467}' +
    '.act-row{display:flex;gap:8px;margin-top:8px}' +
    '.act-row button{border:1px solid #cfd4dc;background:#fff;color:#14171c;border-radius:8px;padding:5px 10px;font-size:12px;cursor:pointer}' +
    '.act-row button:disabled{opacity:.5;cursor:default}' +
    '.act-row .act-yes{background:' + color + ';border-color:' + color + ';color:#fff;font-weight:600}' +
    '.act.done{border-color:#d0e6d5}.act.done .act-row{display:none}' +
    '.gen{align-self:stretch;max-width:96%;background:#fff;border:1px solid #e3e6eb;border-radius:12px;padding:10px 11px}' +
    '.gen-h{font-weight:700;font-size:12.5px;color:#14171c;margin-bottom:6px}' +
    '.gen-list{display:flex;flex-direction:column;gap:6px;max-height:240px;overflow-y:auto;padding-right:2px}' +
    '.gen-cards{display:flex;flex-direction:row;gap:8px;overflow-x:auto;overflow-y:hidden;padding-bottom:4px;scroll-snap-type:x proximity;-webkit-overflow-scrolling:touch}' +
    '.gen-cards::-webkit-scrollbar{height:6px}.gen-cards::-webkit-scrollbar-thumb{background:#cfd4dc;border-radius:3px}' +
    '.gen-card{flex:0 0 144px;scroll-snap-align:start;display:flex;flex-direction:column;align-items:stretch;text-align:left;font:inherit;color:inherit;background:#fff;border:1px solid #eef1f5;border-radius:9px;padding:6px;cursor:pointer;overflow:hidden}' +
    '.gen-card:hover{border-color:#94a3b8}.gen-card:focus-visible{outline:2px solid ' + color + ';outline-offset:1px}' +
    '.gen-card-img{display:block;width:100%;height:78px;object-fit:cover;border-radius:6px;background:#f1f5f9;margin-bottom:5px}' +
    '.gen-card-b{display:block;font-weight:600;font-size:12px;line-height:1.25;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
    '.gen-card-s{display:block;color:#667085;font-size:10.5px;margin-top:1px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
    '.gen-card .gen-price{display:block;margin-top:4px;font-size:11.5px;font-weight:600}' +
    '.gen-item{display:flex;justify-content:space-between;gap:10px;border:1px solid #eef1f5;border-radius:8px;padding:7px 9px;font-size:12.5px}' +
    '.gen-item b{display:block;font-weight:600}' +
    '.gen-item span{display:block;color:#667085;font-size:11px;margin-top:1px}' +
    '.gen-price{white-space:nowrap;font-variant-numeric:tabular-nums}' +
    '.gen-row{display:flex;justify-content:space-between;gap:10px;font-size:12.5px;padding:2px 0}' +
    '.gen-row span{color:#667085}' +
    '.gen-total{display:flex;justify-content:space-between;font-weight:700;border-top:1px solid #e3e6eb;margin-top:5px;padding-top:6px;font-size:12.5px}' +
    '.gen-foot{margin-top:6px;font-size:11px;color:#667085}' +
    '.gen-actions{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}' +
    '.gen-actions button{border:1px solid #cfd4dc;background:#fff;color:#14171c;border-radius:7px;padding:4px 9px;font-size:12px;cursor:pointer}' +
    '.gen-actions button:hover{border-color:#94a3b8}' +
    '.gen-chip{display:inline-block;border-radius:999px;padding:1px 8px;font-size:11px;font-weight:600;background:#e7fffb;color:#115e59}' +
    '.gen-chip.bad{background:#fef2f2;color:#991b1b}' +
    '.ft{display:flex;gap:8px;padding:10px;border-top:1px solid #e3e6eb;background:#fff}' +
    'textarea{flex:1;resize:none;height:40px;padding:8px 10px;border:1px solid #cfd4dc;border-radius:10px;color:#14171c;background:#fff}' +
    '.send{border:0;background:' + color + ';color:#fff;border-radius:10px;padding:0 14px;cursor:pointer}' +
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
  function open() { panel.classList.add("open"); input.focus(); }
  function close() { panel.classList.remove("open"); toggleHist(false); }

  function reset() {
    stopPolling();
    handoff = null; seen = {};
    paused = []; sources = []; busy = false;
    thread = null; hist = []; put("thread", ""); put("hist", "[]");
    msgs.innerHTML = ""; add("bot", greeting);
    handoffBar();
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

  function argsText(args) {
    var parts = [];
    Object.keys(args || {}).forEach(function (k) {
      var v = args[k];
      if (v === null || v === undefined || v === "" || v === "null") return;
      parts.push(k + ": " + (typeof v === "object" ? JSON.stringify(v) : v));
    });
    return parts.join(" · ");
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
      head.textContent = opts.title || ("Page action · " + p.name);
      var desc = document.createElement("div"); desc.className = "act-d";
      desc.textContent = argsText(p.args) || "no arguments";
      var row = document.createElement("div"); row.className = "act-row";
      card.appendChild(head); card.appendChild(desc); card.appendChild(row);
      msgs.appendChild(card); msgs.scrollTop = msgs.scrollHeight;

      function done(text) { card.classList.add("done"); head.textContent = text; }

      if (!fn) {
        var wait = document.createElement("button");
        wait.textContent = "Nothing to run"; wait.disabled = true;
        row.appendChild(wait);
        done((opts.title || "Page action · " + p.name) + " · the page has no handler");
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
          done(opts.doneTitle || ("Page updated · " + p.name));
          showView(p, res);
          resolve(res === undefined ? { ok: true } : res);
        }, function (e) {
          yes.disabled = no.disabled = false; yes.textContent = opts.applyLabel || "Apply";
          desc.textContent = (e && e.message) || String(e);
        });
      };
      no.onclick = function () {
        yes.disabled = no.disabled = true;
        done(opts.declineTitle || ("Page action ignored · " + p.name));
        resolve({ ok: false, declined: true });
      };
    });
  }

  function resumeRun(results, onToken) {
    var resume = {};
    results.forEach(function (r) {
      if (!r.p.id) return;
      if (r.p.call) { var m = {}; m[r.p.call] = r.value; resume[r.p.id] = m; }
      else resume[r.p.id] = r.value;
    });
    return token().then(function (tok) {
      return fetch(api + "/v1/chat/resume", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + tok,
          Accept: "text/event-stream"
        },
        body: JSON.stringify({ thread_id: thread, resume: resume, user_id: uid })
      }).then(function (r) {
        if (r.status === 409) throw "This request is no longer waiting for the page.";
        if (r.status === 413) throw "The page result is too large to send.";
        if (!r.ok) throw "Something went wrong (" + r.status + "). Please try again.";
        if (!r.body || !r.body.getReader) {
          return r.text().then(function (raw) { return drain(raw, onToken); });
        }
        return stream(r.body.getReader(), onToken);
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
    var chain = Promise.resolve();
    list.forEach(function (p) {
      chain = chain.then(function () { return askPage(p); }).then(function (value) {
        results.push({ p: p, value: value });
      });
    });
    return chain.then(function () {
      var msg = add("bot", "Thinking…"); msg.classList.add("typing");
      var started = false;
      sources = []; paused = [];
      function onToken(full) {
        if (!started) { started = true; msg.classList.remove("typing"); }
        msg.textContent = full; msgs.scrollTop = msgs.scrollHeight;
      }
      return resumeRun(results, onToken).then(function (out) {
        msg.classList.remove("typing");
        if (handoff) {
          msg.remove();
          sysNote("Sent to the team. A colleague will reply here.");
          return;
        }
        if (paused.length) {
          if (out.reply) msg.textContent = out.reply; else msg.remove();
          var next = paused.slice(); paused = [];
          return runPaused(q, next);
        }
        msg.textContent = out.reply || "Page updated.";
        finish(msg, q);
      }, function (e) {
        msg.remove();
        throw e;
      });
    });
  }

  function frame(block, onToken, reply) {
    var data = [];
    block.split("\n").forEach(function (line) {
      if (line.indexOf("data:") === 0) data.push(line.slice(5).replace(/^ /, ""));
    });
    data = data.join("\n");
    if (!data) return { reply: reply, done: false };
    if (data === "[DONE]") return { reply: reply, done: true };
    var ev; try { ev = JSON.parse(data); } catch (e) { return { reply: reply, done: false }; }
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

  function drain(raw, onToken) {
    var reply = "";
    raw.split(/\r?\n\r?\n/).forEach(function (block) {
      reply = frame(block, onToken, reply).reply;
    });
    return { reply: reply, interrupted: paused.length > 0 };
  }

  function stream(reader, onToken) {
    var dec = new TextDecoder(), buf = "", reply = "";
    function pump() {
      return reader.read().then(function (res) {
        if (res.done) return { reply: reply, interrupted: paused.length > 0 };
        buf += dec.decode(res.value, { stream: true });
        var i;
        while ((i = buf.indexOf("\n\n")) >= 0) {
          var block = buf.slice(0, i); buf = buf.slice(i + 2);
          var r = frame(block, onToken, reply); reply = r.reply;
          if (r.done) return { reply: reply, interrupted: paused.length > 0 };
        }
        return pump();
      });
    }
    return pump();
  }

  function chat(text, onToken, retried) {
    return token().then(function (tok) {
      return fetch(api + "/v1/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + tok,
          Accept: "text/event-stream"
        },
        body: JSON.stringify({ message: text, thread_id: thread, user_id: uid })
      }).then(function (r) {
        if (r.status === 404 && thread && !retried) {
          thread = null; put("thread", "");
          return chat(text, onToken, true);
        }
        if (r.status === 429) throw "Too many messages. Please wait a moment.";
        if (!r.ok) throw "Something went wrong (" + r.status + "). Please try again.";
        if (!r.body || !r.body.getReader) {
          return r.text().then(function (raw) { return drain(raw, onToken); });
        }
        return stream(r.body.getReader(), onToken);
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
    var pending = add("bot", "Thinking…"); pending.classList.add("typing");
    var started = false;
    sources = []; paused = [];
    function onToken(full) {
      if (!started) { started = true; pending.classList.remove("typing"); }
      pending.textContent = full; msgs.scrollTop = msgs.scrollHeight;
    }
    chat(text, onToken).then(function (out) {
      pending.classList.remove("typing");
      if (handoff) {
        pending.remove();
        sysNote("Sent to the team. A colleague will reply here.");
        return;
      }
      if (out.interrupted) {
        if (out.reply) { pending.textContent = out.reply; save("bot", out.reply); }
        else pending.remove();
        var list = paused.slice(); paused = [];
        return runPaused(text, list);
      }
      pending.textContent = out.reply || "(no response)";
      finish(pending, text);
    }).catch(function (e) {
      pending.remove();
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

  window.NMB = { open: open, close: close, send: function (t) { open(); send(t); }, identify: identify, reset: reset, tool: tool, ui: ui, el: el };
})();