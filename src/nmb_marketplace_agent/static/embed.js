/* NMB Agent chat widget. Usage:
   <script src="https://YOUR-HOST/embed.js" data-key="pk_..." data-title="Support"
           data-color="#2f5cff" data-greeting="Hi! How can I help?"></script>
   JS API: NMB.open() NMB.close() NMB.send(text) NMB.identify(userId) NMB.reset() */
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
    '.msgs{flex:1;overflow:auto;padding:12px;display:flex;flex-direction:column;gap:8px;background:#f6f7f9}' +
    '.m{max-width:85%;padding:8px 11px;border-radius:12px;white-space:pre-wrap;word-break:break-word}' +
    '.user{align-self:flex-end;background:' + color + ';color:#fff}' +
    '.bot{align-self:flex-start;background:#fff;border:1px solid #e3e6eb}' +
    '.typing{opacity:.6;font-style:italic}' +
    '.fb{align-self:flex-start;margin-top:-4px;font-size:12px;color:#667085}.fb button{background:none;border:0;cursor:pointer;font-size:14px}' +
    '.ft{display:flex;gap:8px;padding:10px;border-top:1px solid #e3e6eb;background:#fff}' +
    'textarea{flex:1;resize:none;height:40px;padding:8px 10px;border:1px solid #cfd4dc;border-radius:10px;color:#14171c;background:#fff}' +
    '.send{border:0;background:' + color + ';color:#fff;border-radius:10px;padding:0 14px;cursor:pointer}' +
    '.send:disabled{opacity:.5}' +
    '</style>' +
    '<button class="fab" aria-label="Open chat">💬</button>' +
    '<div class="panel" role="dialog" aria-label="' + title.replace(/"/g, "") + '">' +
    '<div class="hd"><span class="t"></span><button class="x" aria-label="Close">✕</button></div>' +
    '<div class="msgs"></div>' +
    '<div class="ft"><textarea placeholder="Type a message…" rows="1"></textarea><button class="send">Send</button></div></div>';

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
  function close() { panel.classList.remove("open"); }

  function reset() {
    thread = null; hist = []; put("thread", ""); put("hist", "[]");
    msgs.innerHTML = ""; add("bot", greeting);
  }
  function identify(id) { uid = String(id); put("uid", uid); reset(); }

  function request(text, retried) {
    return fetch(api + "/v1/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + key },
      body: JSON.stringify({ message: text, thread_id: thread, user_id: uid })
    }).then(function (r) {
      if (r.status === 404 && thread && !retried) { thread = null; put("thread", ""); return request(text, true); }
      if (r.status === 429) throw "Too many messages. Please wait a moment.";
      if (!r.ok) throw "Something went wrong (" + r.status + "). Please try again.";
      return r.json();
    });
  }

  function addFeedback(q, a) {
    var f = document.createElement("div"); f.className = "fb";
    ["\uD83D\uDC4D", "\uD83D\uDC4E"].forEach(function (e, i) {
      var b = document.createElement("button"); b.textContent = e;
      b.onclick = function () {
        fetch(api + "/v1/feedback", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + key },
          body: JSON.stringify({ thread_id: thread, rating: i ? "down" : "up", user_message: q, reply: a, user_id: uid }) }).catch(function () {});
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
    request(text, false).then(function (d) {
      thread = d.thread_id; put("thread", thread);
      pending.classList.remove("typing");
      pending.textContent = d.reply || "(no response)";
      save("bot", pending.textContent);
      addFeedback(text, pending.textContent);
    }).catch(function (e) {
      pending.remove();
      add("bot", typeof e === "string" ? e : "Network error. Please try again.");
    }).then(function () { busy = false; sendBtn.disabled = false; });
  }

  $(".fab").onclick = function () { panel.classList.contains("open") ? close() : open(); };
  $(".x").onclick = close;
  sendBtn.onclick = function () { var v = input.value; input.value = ""; send(v); };
  input.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendBtn.click(); }
  });

  if (hist.length) hist.forEach(function (h) { add(h.r === "user" ? "user" : "bot", h.t); });
  else add("bot", greeting);

  window.NMB = { open: open, close: close, send: function (t) { open(); send(t); }, identify: identify, reset: reset };
})();