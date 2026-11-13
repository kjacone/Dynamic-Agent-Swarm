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
  var session = null;  // short-lived token exchanged from the key via /v1/session
  var sources = [];    // citations emitted for the current reply
  var handoff = null;  // open human handoff, or null
  var seen = {};       // handoff message ids already rendered
  var poll = null;     // staff-reply polling timer

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
    '.ft{display:flex;gap:8px;padding:10px;border-top:1px solid #e3e6eb;background:#fff}' +
    'textarea{flex:1;resize:none;height:40px;padding:8px 10px;border:1px solid #cfd4dc;border-radius:10px;color:#14171c;background:#fff}' +
    '.send{border:0;background:' + color + ';color:#fff;border-radius:10px;padding:0 14px;cursor:pointer}' +
    '.send:disabled{opacity:.5}' +
    '</style>' +
    '<button class="fab" aria-label="Open chat">💬</button>' +
    '<div class="panel" role="dialog" aria-label="' + title.replace(/"/g, "") + '">' +
    '<div class="hd"><span class="t"></span><span>' +
    '<button class="h" aria-label="Talk to a human">Talk to a human</button>' +
    '<button class="x" aria-label="Close">✕</button></span></div>' +
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
    stopPolling();
    handoff = null; seen = {};
    thread = null; hist = []; put("thread", ""); put("hist", "[]");
    msgs.innerHTML = ""; add("bot", greeting);
  }
  function identify(id) { uid = String(id); put("uid", uid); session = null; reset(); }

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
    return reply;
  }

  function stream(reader, onToken) {
    var dec = new TextDecoder(), buf = "", reply = "";
    function pump() {
      return reader.read().then(function (res) {
        if (res.done) return reply;
        buf += dec.decode(res.value, { stream: true });
        var i;
        while ((i = buf.indexOf("\n\n")) >= 0) {
          var block = buf.slice(0, i); buf = buf.slice(i + 2);
          var r = frame(block, onToken, reply); reply = r.reply;
          if (r.done) return reply;
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
    sources = [];
    function onToken(full) {
      if (!started) { started = true; pending.classList.remove("typing"); }
      pending.textContent = full; msgs.scrollTop = msgs.scrollHeight;
    }
    chat(text, onToken).then(function (reply) {
      pending.classList.remove("typing");
      if (handoff) {
        pending.remove();
        sysNote("Sent to the team. A colleague will reply here.");
        return;
      }
      pending.textContent = reply || "(no response)";
      if (sources.length) {
        var src = document.createElement("div"); src.className = "src";
        src.textContent = "Sources: " + sources.map(function (x) {
          return "[" + (x.id || "") + "] " + x.title + (x.page ? " (p. " + x.page + ")" : "");
        }).join(" \u00b7 ");
        pending.appendChild(src);
      }
      save("bot", pending.textContent);
      addFeedback(text, pending.textContent);
    }).catch(function (e) {
      pending.remove();
      add("bot", typeof e === "string" ? e : "Network error. Please try again.");
    }).then(function () { busy = false; sendBtn.disabled = false; });
  }

  $(".fab").onclick = function () { panel.classList.contains("open") ? close() : open(); };
  $(".x").onclick = close;
  $(".h").onclick = requestHuman;
  sendBtn.onclick = function () { var v = input.value; input.value = ""; send(v); };
  input.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendBtn.click(); }
  });

  if (hist.length) hist.forEach(function (h) { add(h.r === "user" ? "user" : h.r === "staff" ? "staff" : "bot", h.t); });
  else add("bot", greeting);

  window.NMB = { open: open, close: close, send: function (t) { open(); send(t); }, identify: identify, reset: reset };
})();