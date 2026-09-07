# TuTak — Railway Production Context

## Purpose

This document is the source context for Claude/Astra when working on Railway-related production configuration for TuTak.

Main repository:
`github.com/arman119090-cmyk/TuTak-Platform`

Base working branch:
`claude/tutak-loyalty-mvp-e485jm`

Do not treat historical screenshots or old deployment assumptions as current truth. Repository state describes desired configuration; Railway dashboard describes actual deployed infrastructure. If they differ, document the mismatch before changing anything.

---

## 1. Role of Railway

Railway is the primary platform intended for TuTak production infrastructure.

Render was used earlier for staging/transitional deployment and must not be assumed to be the active production platform.

Do not migrate services back to Render or alter production architecture without explicit approval.

---

## 2. Application architecture

Monorepo structure:

- `apps/api` — NestJS backend
- `apps/mobile` — Expo / React Native
- `apps/admin` — Next.js
- `apps/partner` — Next.js
- `packages/design`
- `packages/i18n`
- `packages/shared-types`

Main infrastructure components:

- PostgreSQL
- Redis / BullMQ
- Railway
- Contabo VPN Gateway
- Viva Business Hub

---

## 3. Railway project

Known project:

- Project: `TuTak`
- Environment: `production`

Previously observed resources/services included:

- `TuTak-Platform` / API
- PostgreSQL
- Redis
- Storage Bucket
- Admin
- Partner

Before any change, verify the current real Railway state. Do not assume old screenshots still match the deployed environment.

---

## 4. PostgreSQL

Production PostgreSQL is intended to run as a separate Railway service.

The backend should consume it through `DATABASE_URL`.

Preferred Railway pattern is a reference variable, for example:

```text
DATABASE_URL=${{Postgres.DATABASE_URL}}
```

Do not hardcode production DB credentials in code.

Do not pass the production `DATABASE_URL` into Astra/Claude test environments merely to make integration tests pass.

Production DB and test DB must stay separated.

If local integration tests report PostgreSQL unavailable, that is not evidence that Railway production PostgreSQL is missing or broken. The correct action is to inspect the repository's test database setup and run a separate TEST PostgreSQL instance.

---

## 5. Railway private networking

Use Railway Private Networking for service-to-service traffic inside the same Railway project/environment where appropriate.

Internal service DNS uses the form:

```text
<service>.railway.internal
```

Internal traffic should not unnecessarily go over the public internet.

This especially applies to:

- API ↔ PostgreSQL
- API ↔ Redis
- backend ↔ other internal services

Prefer Railway reference variables over hardcoded internal hostnames.

---

## 6. Public networking

Publicly accessible Railway services can use Railway public domains such as:

```text
*.up.railway.app
```

Custom domains may also be used.

The public API must expose a correct HTTPS endpoint.

Before modifying frontend or mobile API URLs, determine the actual current production API domain directly from Railway.

Do not restore old Render URLs.

---

## 7. Render history and stale references

The repository historically contained references such as:

- `localhost:4000`
- `tutak-staging-api.onrender.com`

A prior cleanup commit is known:

```text
f63b34fbaa687b571eb24dc394f2192929cb64fb
Stop the staging CORS fallback naming the previous provider's hostnames
```

At that point, the reported checks were:

- unit tests: 505/505
- targeted integration tests: 67/67
- typecheck/lint: clean

Do not assume this commit is the current HEAD.

Search for remaining:

- `onrender.com`
- `localhost:4000`
- old Render API URLs
- hardcoded API origins

Classify each occurrence before changing it. Development/test references are not automatically production bugs.

---

## 8. Viva / Contabo architecture

Viva Business Hub must not be treated as an ordinary public API integration.

A separate Contabo VPS was configured as a VPN gateway.

Architecture:

```text
Railway API
    ↓
HTTPS gateway
    ↓
Contabo VPS
    ↓
IPsec / IKEv2
    ↓
Viva private network
    ↓
Business Hub transactional SMS
```

Known network values:

- Contabo public IP: `217.76.49.94`
- Viva peer: `217.76.0.20`
- Viva Encryption Domain: `217.76.1.50/32`
- Our Encryption Domain: `217.76.49.94/32`

The VPN had already reached the state where the Viva private endpoint `217.76.1.50:443` was reachable through the tunnel.

Do not redesign this as a direct Railway-to-Viva IPsec connection unless there is proof that a replacement architecture fully satisfies Viva's site-to-site VPN requirements.

---

## 9. Why Contabo exists

Railway Static Outbound IP is an outbound networking capability. It does not itself replace a site-to-site IPsec gateway.

Therefore the existing Contabo gateway has a valid architectural purpose.

Do not remove it merely because Railway may provide static outbound IP functionality.

---

## 10. Viva Business Hub API client

Business Hub contains an API client for TuTak.

Known non-secret data:

- Client name: `TuTak`
- Client ID: `10064`

A Client Secret exists.

Never:

- commit Client Secret;
- put it into source code;
- put it into GitHub issues/docs;
- print it in logs;
- include it in reports.

Secrets must be stored as environment variables/secrets.

Historically discussed environment names included:

- `SMS_VIVA_CLIENT_ID`
- `SMS_VIVA_CLIENT_SECRET`
- `SMS_VIVA_NUMBER_FORMAT`

But do not blindly create these names. First inspect the current code and determine the actual environment contract.

---

## 11. Railway variables and secrets

Railway Variables are used for build/runtime environment configuration.

Use, as appropriate:

- service variables;
- shared variables;
- reference variables between Railway services;
- sealed/secret handling for sensitive values when compatible with the deployment workflow.

Never hardcode the following into Git:

- `DATABASE_URL`
- Redis credentials
- JWT secrets
- Viva credentials
- Sentry secrets
- API tokens
- passwords
- private keys

---

## 12. Redis / BullMQ

TuTak uses Redis/BullMQ for background jobs.

Verify:

- which Railway Redis service is currently used;
- which env variable connects `apps/api` to it;
- whether private Railway networking is used;
- whether any old external/Render Redis URL remains;
- reconnect/error behavior;
- production health.

Do not change queue semantics unless directly required by a proven issue.

---

## 13. Healthcheck / readiness

Inspect whether the production API already has a health/readiness endpoint.

Railway deployment healthchecks should use an existing appropriate endpoint where possible.

Do not invent a new endpoint if a suitable one already exists.

A deployment should not be considered healthy merely because the container process starts if the API is not actually ready to serve requests.

---

## 14. GitHub and deployment

Previously known workflows include:

- `ci.yml`
- `docker-publish.yml`
- `android-apk.yml`
- `demo-apk.yml`

Determine the actual Railway deployment model:

- which branch deploys;
- which services are linked to GitHub;
- Root Directory / Dockerfile / start commands;
- healthcheck configuration;
- auto-deploy status;
- actual deployed commit SHA.

Do not assume Git HEAD equals the currently deployed Railway SHA.

---

## 15. Mobile app

`apps/mobile` is Expo / React Native.

The mobile application must use a PUBLIC production API endpoint.

Do not use `*.railway.internal` from end-user mobile devices.

Verify the actual mobile production API base URL.

Do not mix Android foldable/input fixes into a Railway infrastructure task.

---

## 16. Admin / Partner

`apps/admin` and `apps/partner` are Next.js applications.

Verify:

- production API URL;
- public/private networking distinction;
- build-time vs runtime variables;
- CORS;
- CSP;
- authentication;
- absence of Render/localhost production fallbacks.

Remember that `NEXT_PUBLIC_*` values can be embedded at build time. Changing only a runtime variable may not alter the frontend bundle if the value was compiled into it.

---

## 17. Storage

A Railway Storage Bucket was previously visible.

Determine:

- whether it is actually used;
- which service uses it;
- what files/data it stores;
- which env/credentials are involved;
- whether it is production storage;
- persistence/backup requirements.

Do not remove storage merely because its usage is not immediately obvious.

---

## 18. Production safety rules

Production is not an experimental environment.

Before changes:

1. identify the current deployed SHA;
2. identify current services;
3. verify health;
4. inspect variable names/presence without exposing secret values;
5. identify service dependencies;
6. establish a rollback path.

Do not:

- print secret values;
- delete services;
- delete volumes;
- delete databases;
- run destructive migrations;
- clear PostgreSQL;
- clear Redis;
- change DNS/domains without explicit approval.

---

## 19. Required Claude/Astra Railway audit

Start with a READ-ONLY audit of Railway-related repository configuration.

Inspect:

1. `apps/api` deployment configuration
2. Dockerfiles
3. Railway config files, if present
4. environment variable contracts
5. PostgreSQL configuration
6. Redis configuration
7. public API URL
8. admin API URL
9. partner API URL
10. mobile production API URL
11. CORS
12. CSP
13. healthcheck/readiness
14. migrations
15. startup command
16. GitHub deployment workflows
17. stale Render references
18. localhost production fallbacks
19. Viva gateway integration
20. secrets handling

Classify findings into:

- `CONFIRMED OK`
- `CONFIRMED PROBLEM`
- `NEEDS RAILWAY UI/ENV VERIFICATION`
- `STALE/LEGACY CONFIG`
- `SECURITY RISK`

Do not fix anything that has not been demonstrated to be a real problem.

---

## 20. Reporting requirements

For each confirmed problem report:

- file;
- relevant lines;
- current behavior;
- why it is a problem;
- production impact;
- minimal fix;
- required tests;
- whether a Railway dashboard change is required.

Perform the audit first.

Do not perform a broad infrastructure refactor.

If a fix is fully proven and safe from repository evidence, make only a minimal change in a separate branch.

Do not deploy to production automatically.

---

## 21. Final principle

Do not reconstruct Railway from stale assumptions.

Repository = desired configuration.

Railway dashboard = actual infrastructure.

When the two differ, document the difference before changing anything.

Final Railway report should contain:

- `RAILWAY STATUS`
- `SERVICES`
- `DATABASE`
- `REDIS`
- `NETWORKING`
- `DOMAINS`
- `ENV CONTRACT`
- `DEPLOYMENT`
- `VIVA GATEWAY`
- `SECURITY`
- `CONFIRMED PROBLEMS`
- `UNVERIFIED ITEMS`
- `RECOMMENDED NEXT ACTIONS`

For every conclusion, clearly separate confirmed fact from assumption.
