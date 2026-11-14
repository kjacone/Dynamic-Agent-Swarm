# Backup and restore runbook — bank pilot

Scope: the Helm release in namespace `nmb` (chart `deploy/helm/nmb-marketplace-agent`,
pilot values `deploy/helm/bank-values.yaml`). Targets below are proposals for the
pilot; agree the final RPO/RTO with the bank.

| Store | Contains | Backup | RPO |
|---|---|---|---|
| Aegra Postgres (`aegra`) | threads, runs, checkpoints, checkpoint blobs/writes, long-term store | `pg_dump -Fc` (or bank PITR) | 24 h (minutes with PITR) |
| Registry Postgres (`NMB_DATABASE_URL`) | agents, models, tools, solutions/snapshots, audit_events, approvals, notifications, privacy requests, holds, feedback, citations | `pg_dump -Fc` | 24 h |
| PVC `/app/data` | FAISS indexes, training files, `connections.json`; `app.db` when the registry is SQLite | CSI VolumeSnapshot (tar fallback) | 24 h |
| Encryption keys | `NMB_ENCRYPTION_KEY` (+ `NMB_ENCRYPTION_KEYS_OLD`) in Secret `nmb-secrets` | **Separate** key custody (Vault/HSM/offline safe) | 0 — held continuously |
| Redis | queues, rate-limit state | not backed up — ephemeral | n/a |
| Qdrant / Langfuse | vectors / traces (external) | bank-owned; re-index vectors if lost | per bank |

Suggested pilot RTO: 2 hours (full restore into a clean namespace).

**Treat every dump as confidential.** PII text columns and checkpoint blobs are
ciphertext, but `audit_events.details`, connector config JSON, notification
routing metadata and scalar checkpoint values are plaintext. Dumps must be
encrypted at rest by the storage layer and access-logged.

## 1. Encryption key custody (do this before the first backup)

The key ring is read from the environment only. A backup without its key restores
to unreadable PII — treat the key as the most critical asset.

1. Generate exactly once: `python -m nmb_marketplace_agent.crypto generate`.
2. Store it in the bank's secret manager (Vault/HSM-backed) and in a sealed
   offline copy held by a second custodian under a two-person rule. Never store
   it in the same bucket, account or backup set as the dumps.
3. Record the key id (`sha256(key).hexdigest()[:8]`) in the backup manifest so the
   right key can be matched before a restore.
4. Put the key in Secret `nmb-secrets` under `NMB_ENCRYPTION_KEY`. The chart
   mounts it at `/etc/nmb/encryption/key` (mode `0400`) in both admin-api and
   Aegra; `encryption.required=true` makes a missing key fail startup.
5. Quarterly: prove custody by decrypting a copy of `crypto status` output with
   each stored key copy. Run a restore drill (section 5).

## 2. Prerequisites

- `kubectl` with namespace admin, read access to Secret `nmb-secrets` (for the
  DSNs only during the window), `pg_dump`/`pg_restore` 16+ reachable from a jump
  host (or the `postgres:16-alpine` helper below).
- The bank Postgres DSNs as libpq URIs (strip `+asyncpg` from `NMB_DATABASE_URL`).
- A CSI `VolumeSnapshotClass` for the data PVC (`kubectl get volumesnapshotclass`)
  or a staging bucket for the tar fallback.
- Announce a write freeze; in-flight chat runs are lost when Aegra stops.

## 3. Backup procedure (maintenance window)

```bash
NS=nmb
REL=nmb
ADMIN=$(kubectl -n $NS get deploy -l app.kubernetes.io/component=admin-api -o name)
AEGRA=$(kubectl -n $NS get deploy -l app.kubernetes.io/component=aegra -o name)
PVC=$(kubectl -n $NS get pvc -l app.kubernetes.io/instance=$REL -o jsonpath='{.items[0].metadata.name}')
STAMP=$(date +%F)
```

1. **Quiesce.** No writes while copying:

   ```bash
   kubectl -n $NS scale $ADMIN $AEGRA --replicas=0
   kubectl -n $NS rollout status $ADMIN --timeout=300s
   kubectl -n $NS rollout status $AEGRA --timeout=300s
   ```

2. **Postgres dumps.** Run from the jump host (preferred) or a helper pod. Read
   the DSNs from Secret `nmb-secrets` (`NMB_DATABASE_URL`) and the Aegra
   Postgres secret; pass the password via `PGPASSWORD`, not argv.

   ```bash
   pg_dump -Fc --no-owner -d "$AEGRA_DSN"   > aegra-$STAMP.dump
   pg_dump -Fc --no-owner -d "$REGISTRY_DSN" > registry-$STAMP.dump
   pg_restore --list aegra-$STAMP.dump > /dev/null   # integrity check
   ```

   If the bank runs the registry on SQLite (no `NMB_DATABASE_URL`), skip the
   registry dump here — `app.db` is on the PVC (step 3), copied only while paused.

3. **PVC snapshot.**

   ```bash
   kubectl apply -f - <<EOF
   apiVersion: snapshot.storage.k8s.io/v1
   kind: VolumeSnapshot
   metadata: {name: nmb-data-$STAMP, namespace: $NS}
   spec:
     volumeSnapshotClassName: <class>
     source: {persistentVolumeClaimName: $PVC}
   EOF
   kubectl -n $NS wait volumesnapshot/nmb-data-$STAMP --for=jsonpath='{.status.readyToUse}'=true --timeout=600s
   ```

   Fallback (no CSI snapshots): mount the PVC in a throwaway pod and tar it to
   the staging bucket.

   ```bash
   kubectl -n $NS run data-copy --restart=Never --image=alpine \
     --overrides='{"spec":{"containers":[{"name":"c","image":"alpine","command":["sleep","3600"],
       "volumeMounts":[{"name":"d","mountPath":"/data"}]}],
       "volumes":[{"name":"d","persistentVolumeClaim":{"claimName":"'$PVC'"}}]}}'
   kubectl -n $NS wait --for=condition=Ready pod/data-copy --timeout=120s
   kubectl -n $NS exec data-copy -- tar czf - -C /data . > data-$STAMP.tgz
   tar tzf data-$STAMP.tgz > /dev/null                    # integrity check
   kubectl -n $NS delete pod data-copy
   ```

4. **Manifest.** Write one file next to the backups containing: release revision
   (`helm -n $NS history $REL`), chart version, image tags, key ids in the ring,
   snapshot name, dump checksums (`sha256sum`), DSN hosts (never passwords), and
   the operator's name. Store it with the dumps under the bank's retention policy.

5. **Resume and verify the live site** (section 4) before closing the window.

## 4. Routine post-backup verification

```bash
kubectl -n $NS scale $ADMIN $AEGRA --replicas=2
kubectl -n $NS rollout status $ADMIN
kubectl -n $NS rollout status $AEGRA
curl -fsS https://api.nmb.bank.internal/health
curl -fsS -H "Authorization: Bearer $ADMIN_TOKEN" \
  https://api.nmb.bank.internal/enterprise/audit/verify
```

Open the dashboard, load a Solutions page, open an existing thread and send one
message. This proves DB, checkpoints and the key ring are all healthy.

## 5. Restore procedure

### 5.1 Full restore into a clean namespace (disaster recovery)

Restore the key **first**; without it every PII column and every checkpoint blob
is unreadable. Never start the API with `NMB_ENCRYPTION_REQUIRED=true` and a key
that does not match the dumps.

1. Create namespace and Secret with the exact `NMB_ENCRYPTION_KEY` (and the old
   keys from the manifest under `NMB_ENCRYPTION_KEYS_OLD` if the dumps predate a
   rotation), plus `ADMIN_TOKEN`, `NMB_JWT_SECRET`, `POSTGRES_PASSWORD`,
   `NMB_DATABASE_URL`.
2. Provision fresh Postgres databases (Aegra and registry) and restore into them:

   ```bash
   pg_restore -d "$AEGRA_DSN" --no-owner --clean --if-exists aegra-$STAMP.dump
   pg_restore -d "$REGISTRY_DSN" --no-owner --clean --if-exists registry-$STAMP.dump
   ```

   Bank-managed PITR: restore to the agreed timestamp instead, then continue.
3. Restore the PVC. From a snapshot, create a PVC whose `dataSource` is the
   snapshot and point `persistence.existingClaim` at it; from a tar, create the
   PVC and untar the archive into it with the helper pod from section 3, step 3
   (`kubectl exec data-copy -- tar xzf - -C /data < data-<stamp>.tgz`).
4. Install with `bank-values.yaml`, adjusting Postgres hosts and the claim name.
   With `migrations.enabled=true` the pre-install Job runs `alembic upgrade head`;
   otherwise run `python -m alembic upgrade head` in the admin-api image before
   the first API start. Keep `adminApi.autoCreateTables=false` on a restored DB.
5. Scale up and run the verification checklist (section 6).

### 5.2 Registry-only restore (logical, no outage for chat)

1. `pg_restore` the dump into a new database, e.g. `nmb_restore`.
2. Run migrations against it if the dump is from an older chart version.
3. Update `NMB_DATABASE_URL` in the Secret and restart the admin-api deployment
   (`kubectl -n $NS rollout restart $ADMIN`). Aegra is unaffected.
4. Verify audit chain and marketplace pages; keep `nmb_restore` until sign-off.

### 5.3 What cannot be restored

- **Lost key** → encrypted columns and all checkpoint blobs are gone. There is no
  recovery path; this is why custody is section 1.
- **Wrong key / missing old key** → `crypto status` or `checkpoint_store status`
  raises `EncryptionKeyMissing` naming the key id; add that key to
  `NMB_ENCRYPTION_KEYS_OLD` (Secret) and restart, then run the commands below.
- **Redis** → queued jobs and rate-limit counters are lost; replicate as needed.
- **Qdrant / Langfuse** → outside this backup set; vectors are re-derivable by
  re-indexing knowledge sources, traces are Langfuse's responsibility.

## 6. Post-restore verification checklist

```bash
kubectl -n $NS rollout status $ADMIN
kubectl -n $NS rollout status $AEGRA
curl -fsS https://api.nmb.bank.internal/health
curl -fsS -H "Authorization: Bearer $ADMIN_TOKEN" \
  https://api.nmb.bank.internal/enterprise/audit/verify
curl -fsS -H "Authorization: Bearer $ADMIN_TOKEN" \
  https://api.nmb.bank.internal/enterprise/compliance/evidence
```

In-cluster secret and ciphertext checks:

```bash
# PII columns: plaintext must be 0 for a fully encrypted restore
kubectl -n $NS exec $ADMIN -- python -m nmb_marketplace_agent.crypto status
# print "plaintext" counts; if non-zero (pre-encryption rows), seal them:
kubectl -n $NS exec $ADMIN -- python -m nmb_marketplace_agent.crypto reencrypt

# Checkpoint blobs: plaintext must be 0
kubectl -n $NS exec $AEGRA -- python -m nmb_marketplace_agent.checkpoint_store status
kubectl -n $NS exec $AEGRA -- python -m nmb_marketplace_agent.checkpoint_store rewrap
```

Then in the browser: sign in, open a pre-backup thread (checkpoint decrypts and
history renders), send a message, open an installed pack and run a sample case,
and confirm marketplace/licence state. Record the result as restore evidence.

## 7. Key rotation (no data rewrite on its own)

1. Add the new key as `NMB_ENCRYPTION_KEY`; move the previous one into
   `NMB_ENCRYPTION_KEYS_OLD` (comma-separated). Restart admin-api and Aegra.
2. Seal existing data onto the new key:

   ```bash
   kubectl -n $NS exec $ADMIN -- python -m nmb_marketplace_agent.crypto reencrypt
   kubectl -n $NS exec $AEGRA -- python -m nmb_marketplace_agent.checkpoint_store rewrap
   ```

3. Confirm completion by re-running both — they skip rows already on the current
   key, so a second run must report `written: 0` / no writes. Only then remove
   the old key from `NMB_ENCRYPTION_KEYS_OLD`, restart, and update the manifest.
4. Keep the retired key in custody for as long as any backup encrypted with it is
   retained.

## 8. Drill and evidence

- Run a full restore into a scratch namespace once before go-live and quarterly
  after; time it against the RTO.
- Keep per-drill evidence: backup manifest, checksums, restore start/end times,
  command output from section 6, operator and approver names. This doubles as
  the ISO 27001 A.8.13 (backup) / A.8.24 (key custody) evidence for the pilot.
- Retain daily backups per the bank's policy; expiring a backup is also the point
  at which the matching retired key can leave custody.
