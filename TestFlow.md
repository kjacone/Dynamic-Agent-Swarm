# NMB Marketplace Agent
## End-to-End Implementation, Testing, Security Hardening & Customer Deployment Guide

**Document type:** Technical Implementation Guide  
**Platform:** NMB Marketplace Agent  
**Target environment:** Local development, enterprise on-premises and air-gapped deployments  
**Version:** 0.1.0

---

## Table of Contents

1. [Run the Demo Script](#step-1-run-the-demo-script)
2. [Test the Dashboard Against a Real Server](#step-2-test-the-dashboard-against-a-real-server)
3. [Run Against a Real LLM](#step-3-run-against-a-real-model)
4. [Security Hardening](#step-4-hardening-for-security-reviews)
5. [Package for Enterprise Customers](#step-5-packaging-for-customers)
6. [Design and Execute a Customer Pilot](#step-6-pilot-design)

---

# Step 1: Run the Demo Script

Start by verifying that the demo script executes successfully.

### 1.1 Execute the demo

```bash
uv run python scripts/demo_kyc.py
```

### 1.2 Expected result

The script should:

- Execute eight numbered sections.
- Demonstrate the KYC audit workflow.
- Show the audit chain verification process.
- Demonstrate what happens when an audit event is tampered with.
- End with a message similar to:

```text
chain BROKEN at event #N
```

This confirms that the audit integrity mechanism detects tampering.

### 1.3 Troubleshooting

If the script fails, the most likely causes include:

- Import errors.
- Incorrect class or function names.
- Missing database columns.
- A mismatch in the `AgentConfig` model.
- Inconsistencies between the migration and application models.

Pay particular attention to:

```text
config/models.py
```

Both the demo and database migration depend on this module. Any mismatch should be investigated here first.

---

# Step 2: Test the Dashboard Against a Real Server

The next step is to verify the backend API, authentication, role-based access control, and dashboard functionality against a running server.

## 2.1 Configure secrets and start the backend

Generate the required secrets and store them in your `.env` file.

```bash
# Generate secrets and store them in .env.
# Never commit this file to Git.

cat >> .env <<EOF
ADMIN_TOKEN=$(openssl rand -hex 24)
NMB_JWT_SECRET=$(openssl rand -hex 32)
AUDIT_HMAC_KEY=$(openssl rand -hex 32)
REDACTION_KEY=$(openssl rand -hex 32)
WEBHOOK_SECRET=$(openssl rand -hex 32)
CORS_ORIGINS=http://localhost:5173
EOF
```

Load the environment variables:

```bash
set -a
source .env
set +a
```

Run the database migrations:

```bash
uv run alembic upgrade head
```

Start the API server:

```bash
uv run uvicorn nmb_marketplace_agent.api.main:app --port 8000 --reload
```

Use the command specified in your README if it differs.

Expected backend address:

```text
http://localhost:8000
```

## 2.2 Start the dashboard

Open a second terminal:

```bash
cd dashboard

npm install
npm run dev
```

Expected dashboard address:

```text
http://localhost:5173
```

## 2.3 Generate named-user JWT tokens

Create the following file:

**File:** `scripts/mint_token.py`

```python
import os
import sys
import time
import jwt

sub, tenant, *roles = sys.argv[1:]

print(
    jwt.encode(
        {
            "sub": sub,
            "tenant_id": tenant,
            "roles": roles,
            "exp": int(time.time()) + 8 * 3600,
        },
        os.environ["NMB_JWT_SECRET"],
        algorithm="HS256",
    )
)
```

Generate tokens for different enterprise users:

```bash
export TENANT=acme-bank

ADMIN_JWT=$(uv run python scripts/mint_token.py admin@acme.bank $TENANT tenant_admin)

OPS_JWT=$(uv run python scripts/mint_token.py ops1@acme.bank $TENANT operator)

OFF1_JWT=$(uv run python scripts/mint_token.py officer1@acme.bank $TENANT compliance_officer)

OFF2_JWT=$(uv run python scripts/mint_token.py officer2@acme.bank $TENANT compliance_officer)

AUD_JWT=$(uv run python scripts/mint_token.py auditor@acme.bank $TENANT auditor)
```

To obtain an officer token for dashboard testing:

```bash
echo "$OFF1_JWT"
```

Copy the generated token into the dashboard login screen.

**Security note:** These tokens are temporary development credentials. Do not share them, commit them, or use this token-minting approach as a substitute for production identity management.

## 2.4 Verify the enterprise API endpoints

### Check the authenticated user

```bash
curl -s localhost:8000/enterprise/me \
  -H "Authorization: Bearer $ADMIN_JWT"
```

### Install the Banking KYC solution

```bash
curl -s -X POST \
  localhost:8000/enterprise/solutions/banking-kyc/install \
  -H "Authorization: Bearer $ADMIN_JWT" \
  -H 'Content-Type: application/json' \
  -d '{"parameters":{}}'
```

### Retrieve enterprise workflows

```bash
curl -s localhost:8000/enterprise/workflows \
  -H "Authorization: Bearer $OPS_JWT"
```

### Verify the audit chain

```bash
curl -s localhost:8000/enterprise/audit/verify \
  -H "Authorization: Bearer $AUD_JWT"
```

## 2.5 Test role-based dashboard access

Sign in using each token and verify the displayed screens and permissions.

| User / Token | Expected dashboard access |
|---|---|
| `ADMIN_TOKEN` | Everything, but approval buttons should be disabled with an explanatory reason |
| `$ADMIN_JWT` | Enterprise screens, without the Build section |
| `$OFF1_JWT` | Approvals only |
| `$AUD_JWT` | Audit trail and Governance only |

**Important:** The dashboard's Connectors screen discussed previously requires the corresponding connector implementation to be added before testing.

---

# Step 3: Run Against a Real Model

The next step is to connect the KYC agents to an actual language model and execute a real workflow.

## 3.1 Install and start Ollama

If Ollama is not already installed:

```bash
brew install ollama
```

Start the Ollama service:

```bash
ollama serve &
```

Skip this command if Ollama is already running.

Download the model:

```bash
ollama pull llama3.1:8b
```

Verify the installed models:

```bash
ollama list
```

## 3.2 Start the agent runtime

The workflow agent steps communicate with your LangGraph/Aegra runtime through `LANGGRAPH_URL`.

Default:

```text
http://127.0.0.1:2024
```

Start the runtime using the command specified in your README.

Possible commands:

```bash
uv run aegra dev
```

Or:

```bash
uv run langgraph dev
```

Verify that the runtime is responding:

```bash
curl -s http://127.0.0.1:2024/ok
```

## 3.3 Configure the KYC agents to use Ollama

First, inspect the model naming convention used by the repository:

```bash
uv run python -c \
"from nmb_marketplace_agent.config.settings import settings; print(settings.main_model)"
```

Use the returned naming convention when configuring the KYC solution.

For Ollama, the model identifier is often:

```text
ollama:llama3.1:8b
```

However, verify the actual provider format supported by your implementation.

Install the solution with the selected model:

```bash
curl -s -X POST \
  localhost:8000/enterprise/solutions/banking-kyc/install \
  -H "Authorization: Bearer $ADMIN_JWT" \
  -H 'Content-Type: application/json' \
  -d '{"parameters":{"model":"ollama:llama3.1:8b"}}'
```

## 3.4 Execute evaluations and a real KYC case

### A. Run the evaluation dataset

In the dashboard:

1. Open **Evaluations**.
2. Select `kyc-extraction`.
3. Execute the evaluation.
4. Review the results and identify failed test cases.

### B. Execute a KYC onboarding workflow

Navigate to:

**Workflows → kyc_onboarding → Start run**

Provide the following input:

```yaml
customer_name: Jane Wanjiru
country: KE
declared_income: 90000
documents_text: Passport 12345678. Name Jane Wanjiru. DOB 1990-04-12. Employer: Mama Mboga Wholesale Ltd.
```

### C. Inspect the workflow execution

Open the generated workflow run and inspect:

- Agent execution steps.
- Extracted customer information.
- Risk scoring results.
- Workflow state transitions.
- Approval requirements.
- Execution errors.

### D. Troubleshoot model output failures

If the workflow fails at a `set` step or produces an empty risk score, the model may have returned JSON that the solution pack cannot parse.

This is particularly likely with smaller 8B models.

**Recommended fixes, in order:**

1. **Use a stronger model.** Consider a hosted model or a 70B local model.
2. **Improve the agent prompts.** Edit:

   ```text
   solutions/packs/banking-kyc.yaml
   ```

   Add an instruction such as:

   ```text
   Return only valid JSON. Do not include Markdown, explanations, or additional text.
   ```

3. **Add retries.** Configure `retries: 2` for the `extract` and `score_raw_step` steps in the solution pack, ensuring the runtime supports retries for those steps.

### E. Verify the guardrails

Open:

**Governance → Policy tester**

Test the following:

- Sample credit card number.
- Prompt injection sample.
- Sensitive data detection.
- Input redaction.

Then paste the credit card sample into a workflow input.

Verify that the model receives a redacted value similar to:

```text
[CREDIT_CARD:…]
```

The original sensitive value should not be unnecessarily exposed to the model or downstream logs.

---

# Step 4: Hardening for Security Reviews

Before presenting the platform to banks or enterprise customers, assess its security posture and address the outstanding production requirements.

## 4.1 Check compliance readiness

Run:

```bash
curl -s localhost:8000/enterprise/compliance/readiness \
  -H "Authorization: Bearer $AUD_JWT" \
  | python3 -c "
import sys, json
[
    print(c['status'].upper().ljust(5), c['title'])
    for c in json.load(sys.stdin)['posture']['checks']
]
"
```

Alternatively, open:

**Governance → Compliance & posture**

Each failing check should display the corresponding remediation requirement.

## 4.2 Configure the production environment

The following configuration illustrates the expected production settings.

```bash
AUTH_TYPE=<your real mode>

EGRESS_ALLOWED_HOSTS=sanctions.bank.internal,core.bank.internal

OIDC_JWKS_URL=https://login.microsoftonline.com/<tenant>/discovery/v2.0/keys

OIDC_ISSUER=https://login.microsoftonline.com/<tenant>/v2.0

OIDC_AUDIENCE=<your app id>

OIDC_ROLE_MAP="Bank-Approvers=compliance_officer,Bank-Audit=auditor"

LICENSE_ENFORCE=true

LICENSE_PUBLIC_KEY="$(cat license_public.pem)"

AUTO_CREATE_TABLES=false

ADMIN_TOKEN=<32+ chars>
```

Replace all placeholders with actual deployment values.

For production:

- Do not use `AUTH_TYPE=noop`.
- Use a real identity provider.
- Enforce tenant isolation.
- Keep private signing keys off application servers.
- Use strong secrets and a managed secret distribution mechanism.
- Restrict outbound network traffic.
- Use PostgreSQL rather than SQLite.
- Disable automatic table creation.
- Enforce licensing.

## 4.3 Remaining security hardening tasks

The following are outstanding implementation tasks, ordered by impact.

### 1. Replace in-memory rate limiting with Redis

The current in-memory limiter in:

```text
api/auth.py
```

should be replaced with Redis-backed rate limiting.

Reasons:

- In-memory limits are not shared across application workers.
- Limits reset when processes restart.
- Distributed deployments need centralized rate-limit state.
- Redis allows more consistent enforcement across multiple API instances.

### 2. Enforce row-level audit protection

The PostgreSQL trigger in the migration already blocks audit event updates and deletes.

Production deployments must use PostgreSQL rather than SQLite to benefit from this protection.

Verify:

- Trigger installation.
- Database permissions.
- Audit event immutability.
- Transaction behaviour.
- Database backup and recovery procedures.

### 3. Run security scanners

Install the required scanners:

```bash
uv run pip install bandit pip-audit
```

Run Python static security analysis:

```bash
uv run bandit -r src -ll
```

Audit Python dependencies:

```bash
uv run pip-audit
```

Audit dashboard dependencies:

```bash
cd dashboard
npm audit --omit=dev
```

Review and resolve the reported vulnerabilities before the penetration test.

### 4. Back up audit checkpoints externally

Generate an audit checkpoint:

```bash
curl -s localhost:8000/enterprise/audit/checkpoint \
  -H "Authorization: Bearer $AUD_JWT" \
  >> checkpoints.jsonl
```

Schedule this operation daily.

After generating the checkpoint, copy it to external write-once storage with object-lock protection.

The backup strategy should also include:

- Retention policies.
- Backup integrity verification.
- Recovery testing.
- Restricted access.
- Monitoring of failed backup operations.

---

# Step 5: Packaging for Enterprise Customers

Prepare the platform for distribution to enterprise customers, including banks requiring on-premises or air-gapped deployment.

## 5.1 Generate licence keys offline

Generate the signing key pair:

```bash
uv run python scripts/issue_license.py keygen > keys.pem
```

Split the resulting PEM output into:

```text
license_private.pem
license_public.pem
```

The files should contain their respective:

```text
-----BEGIN PRIVATE KEY-----
```

and:

```text
-----BEGIN PUBLIC KEY-----
```

blocks.

**Security requirements:**

- Keep `license_private.pem` offline.
- Never include the private key in Docker images.
- Never distribute the private key to customers.
- Embed or distribute only the public verification key with the application.

## 5.2 Issue an enterprise customer licence

Example licence for Acme Bank:

```bash
uv run python scripts/issue_license.py issue \
  --key license_private.pem \
  --customer "Acme Bank" \
  --edition enterprise \
  --modules core,audit,guardrails,workflows,approvals,connectors,solutions,compliance,sso \
  --solutions banking-kyc,enterprise-automation \
  --tenants 2 \
  --seats 150 \
  --deployment air_gapped \
  --quota agent_runs=500000 \
  --quota tokens=200000000 \
  --days 365
```

The command should produce a licence token.

Provide this token to the customer as:

```bash
LICENSE_KEY=<customer_license_token>
```

Keep customer licence information and signing operations controlled and auditable.

## 5.3 Build deployable Docker images

Build the API image:

```bash
docker build -t nmb-api:0.1.0 .
```

Build the dashboard image:

```bash
docker build -t nmb-dashboard:0.1.0 dashboard/
```

Package both images for air-gapped distribution:

```bash
docker save nmb-api:0.1.0 nmb-dashboard:0.1.0 \
  | gzip > nmb-release-0.1.0.tar.gz
```

## 5.4 Deploy on the customer environment

Transfer the release archive to the customer's deployment environment.

Load the Docker images:

```bash
docker load < nmb-release-0.1.0.tar.gz
```

Start the deployment:

```bash
docker compose up -d
```

Run database migrations:

```bash
docker compose exec api alembic upgrade head
```

Verify the services, database connectivity, application health, authentication and licence enforcement.

**Production packaging consideration:** The API and dashboard images are not, by themselves, a complete air-gapped deployment. The customer release should also include the required database, Redis, runtime, model-serving dependencies, configuration templates, migration instructions and offline installation assets.

## 5.5 Prepare enterprise documentation

Banks commonly request technical and security documentation during the initial vendor assessment.

The following documents should be prepared:

| Document | Purpose |
|---|---|
| Security Architecture Overview | Explains architecture, data flows and trust boundaries |
| Shared Responsibility Matrix | Defines responsibilities between the vendor and customer |
| Security Questionnaire | Provides responses to SIG Lite, CAIQ or customer-specific questionnaires |
| Deployment Guide | Explains on-premises and air-gapped installation |
| Operations Runbook | Covers incidents, backups, recovery and audit-chain failures |
| Data Processing Agreement | Defines data processing obligations |
| Subprocessor List | Identifies external providers and subprocessors |

---

# Step 6: Design and Execute a Customer Pilot

The final step is to validate the platform with a real enterprise partner before broader commercial deployment.

## 6.1 Select a pilot partner and solution pack

Choose one partner and one initial solution pack.

Recommended starting options:

- Banking KYC.
- Insurance claims processing.

Agree on the following before implementation:

### A. Pilot scope

Example:

```text
Process 10–15% of new retail customer onboardings
over an eight-week pilot, beginning in shadow mode.
```

### B. Baseline measurements

Measure existing performance before introducing the platform:

- Average minutes per KYC case.
- Number of cases processed per officer per day.
- Existing error and rework rates.
- Current EDD escalation rates.
- Existing SLA breach rates.

### C. Success metrics

Use the solution pack's existing metrics:

- Straight-through processing rate.
- Median onboarding time.
- EDD SLA breach rate.

### D. Compliance approval

Obtain the compliance team's approval of:

- Agent prompts.
- Risk scoring thresholds.
- Escalation rules.
- Approval requirements.
- Data handling and retention policies.

## 6.2 Run the pilot in shadow mode

During weeks 1–2, the platform should process approximately 50–100 anonymised historical cases.

Human decisions remain the reference point.

The process should be:

1. Submit anonymised historical cases.
2. Let the platform process each case.
3. Compare the platform's outputs against human decisions.
4. Record disagreements.
5. Review every disagreement.
6. Adjust prompts and configuration.
7. Re-run evaluations.

Example: Configure the Banking KYC solution.

```bash
curl -s -X POST \
  localhost:8000/enterprise/solutions/banking-kyc/install \
  -H "Authorization: Bearer $ADMIN_JWT" \
  -H 'Content-Type: application/json' \
  -d '{"parameters":{"edd_threshold":60,"edd_approvers":2}}'
```

Reinstalling the solution preserves earlier tuning and creates a new workflow version, so existing running cases are not affected.

Verify this versioning behaviour in the deployed implementation before relying on it operationally.

## 6.3 Generate weekly pilot reports

### A. Retrieve usage information

```bash
curl -s localhost:8000/enterprise/usage \
  -H "Authorization: Bearer $AUD_JWT"
```

Export usage data:

```bash
curl -s localhost:8000/enterprise/usage/export.csv \
  -H "Authorization: Bearer $AUD_JWT" \
  -o usage.csv
```

### B. Retrieve workflow runs

```bash
curl -s "localhost:8000/enterprise/runs?limit=500" \
  -H "Authorization: Bearer $AUD_JWT" \
  > runs.json
```

Calculate median workflow execution time:

```bash
python3 - <<'EOF'
import json
import statistics as st
from datetime import datetime

runs = json.load(open("runs.json"))

done = [
    r for r in runs
    if r["status"] == "completed"
]

mins = [
    (
        datetime.fromisoformat(r["updated_at"].rstrip("Z"))
        -
        datetime.fromisoformat(r["created_at"].rstrip("Z"))
    ).total_seconds() / 60
    for r in done
]

print(
    f"runs={len(runs)} completed={len(done)} "
    f"median_minutes={st.median(mins):.1f}"
    if mins else "no completed runs yet"
)
EOF
```

**Reporting consideration:** The calculated median includes time spent waiting for human approvers.

Report the following separately:

- Straight-through cases.
- Cases requiring human approval.
- Total processing time.
- Actual agent execution time.
- Human approval waiting time.

### C. Export compliance evidence

Export compliance evidence:

```bash
curl -s localhost:8000/enterprise/compliance/evidence \
  -H "Authorization: Bearer $AUD_JWT" \
  -o evidence.json
```

Export audit records:

```bash
curl -s localhost:8000/enterprise/audit/export \
  -H "Authorization: Bearer $AUD_JWT" \
  -o audit.jsonl
```

Use these artifacts to prepare the weekly report for the partner's compliance team.

## 6.4 Define pilot exit criteria

Agree on measurable success criteria before the pilot begins.

| Criteria | Example target |
|---|---|
| Auditor agreement | At least 95% of low-risk decisions confirmed |
| Sanctions screening | Zero missed sanctions hits |
| Audit integrity | Audit chain successfully verified at every weekly check |
| Processing efficiency | Median handling time reduced by an agreed percentage |
| Customer validation | Written reference or case study from the partner |

The pilot should only be considered successful when the agreed operational, compliance and technical requirements have been met.

---

# Final Implementation Checklist

Use this checklist to track progress toward production readiness.

## Phase 1: Core functionality

- [ ] Demo script executes successfully.
- [ ] Eight demo sections complete.
- [ ] Audit tampering detection works.
- [ ] Database migrations execute successfully.
- [ ] API starts without errors.
- [ ] Dashboard starts successfully.

## Phase 2: Enterprise functionality

- [ ] JWT authentication works.
- [ ] Tenant isolation is verified.
- [ ] Role-based access control is verified.
- [ ] Banking KYC solution installs successfully.
- [ ] Enterprise workflows are accessible.
- [ ] Approval permissions are enforced.
- [ ] Audit verification endpoint works.
- [ ] Connectors screen is implemented and tested.

## Phase 3: AI and agent runtime

- [ ] Ollama or another LLM provider works.
- [ ] LangGraph/Aegra runtime is operational.
- [ ] Model configuration is correct.
- [ ] KYC extraction evaluation passes.
- [ ] KYC onboarding workflow completes.
- [ ] Risk scoring produces valid output.
- [ ] Agent retries work as expected.
- [ ] Prompt injection guardrails are tested.
- [ ] Sensitive data redaction is verified.

## Phase 4: Security and compliance

- [ ] Production authentication is configured.
- [ ] OIDC/SSO integration works.
- [ ] Redis-backed rate limiting is implemented.
- [ ] PostgreSQL audit protection is verified.
- [ ] Egress restrictions are enforced.
- [ ] Licence enforcement works.
- [ ] Bandit scan completed.
- [ ] Python dependency audit completed.
- [ ] Dashboard dependency audit completed.
- [ ] Audit checkpoints are backed up externally.
- [ ] Compliance readiness checks pass.
- [ ] Penetration testing completed.

## Phase 5: Enterprise packaging

- [ ] Offline licence generation works.
- [ ] Customer licences can be issued.
- [ ] API Docker image builds.
- [ ] Dashboard Docker image builds.
- [ ] Docker release archive is generated.
- [ ] Air-gapped deployment is tested.
- [ ] Database migrations work in deployment.
- [ ] Required runtime and model assets are packaged.
- [ ] Enterprise documentation is prepared.

## Phase 6: Commercial pilot

- [ ] Pilot partner identified.
- [ ] Solution pack selected.
- [ ] Pilot scope agreed.
- [ ] Baseline performance measured.
- [ ] Compliance team approves configuration.
- [ ] Historical cases processed in shadow mode.
- [ ] Disagreements reviewed.
- [ ] Weekly reporting operational.
- [ ] Audit evidence supplied.
- [ ] Pilot exit criteria achieved.
- [ ] Customer reference secured.

---

## Definition of Done

The NMB Marketplace Agent should be considered ready for an enterprise production pilot when:

1. Core platform functionality works reliably.
2. Enterprise authentication and authorization are enforced.
3. AI workflows execute successfully against a supported model.
4. Guardrails, redaction and audit integrity are verified.
5. Security scanning and remediation are completed.
6. PostgreSQL, Redis and production infrastructure are configured.
7. Licensing and enterprise deployment are tested.
8. Operational and security documentation is available.
9. A controlled customer pilot can be executed and measured.

**Important:** Passing the demo and local integration tests does not automatically establish production readiness. Production readiness requires security validation, operational testing, deployment verification and customer acceptance.