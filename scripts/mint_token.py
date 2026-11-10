import os, sys, time, jwt
sub, tenant, *roles = sys.argv[1:]
print(jwt.encode({"sub": sub, "tenant_id": tenant, "roles": roles, "exp": int(time.time()) + 8 * 3600},
                 os.environ["NMB_JWT_SECRET"], algorithm="HS256"))