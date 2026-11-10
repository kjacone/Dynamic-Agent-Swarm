"""Vendor-side tool (keep the private key offline).

  python scripts/issue_license.py keygen                      # one-time: prints keypair
  python scripts/issue_license.py issue --key priv.pem --customer "Acme Bank" \
      --edition enterprise --modules workflows,approvals,connectors,solutions,compliance,sso \
      --solutions banking-kyc,insurance-claims --tenants 3 --seats 250 --deployment air_gapped \
      --quota agent_runs=500000 --quota tokens=200000000 --days 365
Embed the PUBLIC key in the build (LICENSE_PUBLIC_KEY); give the customer the printed token (LICENSE_KEY).
"""
import argparse
import sys

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from nmb_marketplace_agent.enterprise.licensing import issue_license

ap = argparse.ArgumentParser()
sub = ap.add_subparsers(dest="cmd", required=True)
sub.add_parser("keygen")
i = sub.add_parser("issue")
i.add_argument("--key", required=True)
i.add_argument("--customer", required=True)
i.add_argument("--edition", default="enterprise")
i.add_argument("--modules", default="")
i.add_argument("--solutions", default="*")
i.add_argument("--tenants", type=int, default=1)
i.add_argument("--seats", type=int, default=100)
i.add_argument("--deployment", default="on_prem")
i.add_argument("--quota", action="append", default=[])
i.add_argument("--days", type=int, default=365)
a = ap.parse_args()
if a.cmd == "keygen":
    k = Ed25519PrivateKey.generate()
    sys.stdout.write(k.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()).decode())
    sys.stdout.write(k.public_key().public_bytes(serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo).decode())
else:
    print(issue_license(open(a.key, "rb").read(), customer=a.customer, edition=a.edition,
                        modules=[m for m in a.modules.split(",") if m] or None, solutions=a.solutions.split(","),
                        max_tenants=a.tenants, max_seats=a.seats, deployment=a.deployment,
                        quotas={k: float(v) for k, v in (q.split("=") for q in a.quota)}, days=a.days))
