#!/usr/bin/env bash
# Run from the repo root on your host:  bash scripts/smoke_test.sh
set -u
set -a; [ -f .env ] && . ./.env; set +a
API=http://localhost:8000
AUTH="Authorization: Bearer ${ADMIN_TOKEN:?ADMIN_TOKEN missing}"
ok(){ printf "  \033[32mPASS\033[0m %s\n" "$1"; }
bad(){ printf "  \033[31mFAIL\033[0m %s\n" "$1"; }
chk(){ if eval "$2" >/dev/null 2>&1; then ok "$1"; else bad "$1"; fi; }
pyj(){ python3 -c "$1" 2>/dev/null; }

wait_for() {  # name url [max_seconds]
  local name=$1 url=$2 max=${3:-120} i=0
  printf "  waiting for %s " "$name"
  until curl -sf "$url" >/dev/null 2>&1; do
    i=$((i+3)); [ $i -ge $max ] && { echo; return 1; }
    printf "."; sleep 3
  done
  echo; return 0
}

echo "0. Waiting for services"
wait_for "admin-api"    "$API/health"                   60  || bad "admin-api not up"
wait_for "agent-server" "http://localhost:2026/health"  150 || bad "agent-server not healthy; run: docker compose logs --tail=80 agent-server"

echo "1. Infrastructure"
chk "Ollama on host (has models)" "curl -sf http://localhost:11434/api/tags | grep -q models"
chk "Langfuse web"                "curl -sf http://localhost:3000/api/public/health"
chk "Qdrant"                      "curl -sf http://localhost:6333/healthz"
chk "Aegra agent-server"          "curl -sf http://localhost:2026/health"
chk "Admin API"                   "curl -sf $API/health"
chk "Dashboard (nginx)"           "curl -sf http://localhost:8080 | grep -qi '<div id=\"root\"'"

echo "2. Admin auth"
chk "rejects missing token" "[ \$(curl -s -o /dev/null -w '%{http_code}' $API/agents) = 401 ]"
chk "accepts ADMIN_TOKEN"   "curl -sf -H '$AUTH' $API/auth/check"

echo "3. Service wiring (admin-api -> peers, from inside Docker)"
curl -s -H "$AUTH" "$API/system/status" | python3 -c '
import sys, json
try:
    data = json.load(sys.stdin)
except Exception:
    print("   FAIL could not read /system/status"); sys.exit(0)
for s in data["services"]:
    if s["id"] == "trainer" and not s["ok"]:
        print("   skip", s["name"], "- optional (--profile training)"); continue
    print("  ", "PASS" if s["ok"] else ("skip" if not s["configured"] else "FAIL"), s["name"], "-", s["detail"])
'

echo "4. End-to-end agent run (admin path)"
AGENT_ID=$(curl -s -H "$AUTH" "$API/agents" | pyj 'import sys,json; a=json.load(sys.stdin); print(a[0]["id"] if a else "")' || true)
if [ -z "${AGENT_ID:-}" ]; then
  bad "no agent. Run: docker compose exec admin-api python scripts/seed.py"
else
  ok "agent $AGENT_ID"
  RES=$(curl -s -m 300 -H "$AUTH" -H 'Content-Type: application/json' \
    -d "{\"agent_id\":\"$AGENT_ID\",\"message\":\"What is 12*7? Use the calculator.\"}" "$API/runs/invoke" || true)
  if printf '%s' "${RES:-}" | python3 -c '
import sys, json
d = json.load(sys.stdin)
err = d["result"].get("__error__")
if err:
    print("  graph error:", err["message"][:300]); sys.exit(1)
print("  thread:", d["thread_id"])' ; then
    ok "supervisor graph ran via Aegra"
  else
    bad "invoke failed"; echo "  response: $(printf '%s' "${RES:-}" | head -c 400)"
  fi
fi

echo "5. Langfuse received a trace"
sleep 15
chk "trace visible via admin API" "curl -sf -H '$AUTH' '$API/observability/traces?limit=1' | grep -q '\"id\"'"
echo "  UI: http://localhost:3000 -> project nmb-marketplace -> Tracing"

echo "6. Public API-key path (what agent-kit uses)"
if [ -n "${AGENT_ID:-}" ]; then
  KJSON=$(curl -s -H "$AUTH" -H 'Content-Type: application/json' \
    -d "{\"name\":\"smoke-test\",\"agent_id\":\"$AGENT_ID\",\"kind\":\"publishable\",\"allowed_origins\":[\"*\"]}" "$API/keys" || true)
  KEY=$(printf '%s' "$KJSON" | pyj 'import sys,json; print(json.load(sys.stdin)["key"])' || true)
  KID=$(printf '%s' "$KJSON" | pyj 'import sys,json; print(json.load(sys.stdin)["id"])' || true)
  if [ -z "${KEY:-}" ]; then
    bad "could not create API key: $(printf '%s' "$KJSON" | head -c 300)"
  else
    ok "created temporary publishable key"
    H=(-H "x-api-key: $KEY" -H "Origin: http://localhost:3001" -H "Content-Type: application/json")
    ASSISTANT=$(curl -s "${H[@]}" "$API/v1/config" | pyj 'import sys,json; print(json.load(sys.stdin)["assistantId"])' || true)
    [ -n "${ASSISTANT:-}" ] && ok "/v1/config -> assistant ${ASSISTANT:0:8}" || bad "/v1/config"
    TID=$(curl -s "${H[@]}" -d '{}' "$API/v1/lg/threads" | pyj 'import sys,json; print(json.load(sys.stdin)["thread_id"])' || true)
    [ -n "${TID:-}" ] && ok "thread created via proxy" || bad "thread create via /v1/lg/threads"
    if [ -n "${ASSISTANT:-}" ] && [ -n "${TID:-}" ]; then
      R=$(curl -s -m 300 "${H[@]}" \
        -d "{\"assistant_id\":\"$ASSISTANT\",\"input\":{\"messages\":[{\"role\":\"user\",\"content\":\"Say hello in five words.\"}]}}" \
        "$API/v1/lg/threads/$TID/runs/wait" || true)
      if printf '%s' "$R" | python3 -c '
import sys, json
d = json.load(sys.stdin)
if d.get("__error__"):
    print("  graph error:", d["__error__"]["message"][:300]); sys.exit(1)
ai = [m for m in d.get("messages", []) if m.get("type") == "ai"]
print("  reply:", (ai[-1]["content"] if ai else "")[:120])' ; then
        ok "agent replied through the public proxy"
      else
        bad "run via proxy: $(printf '%s' "$R" | head -c 300)"
      fi
    fi
    [ -n "${KID:-}" ] && curl -s -X DELETE -H "$AUTH" "$API/keys/$KID" >/dev/null
  fi
fi
echo "Done. Browser demo: docker compose --profile demo up -d agent-kit-demo  ->  http://localhost:3001"