# Phase 2 — Auth & RBAC

**Goal:** Credentials login with three roles; session available in server components, route
handlers, and middleware; role helpers used by every later phase.

**Prereqs:** Phase 1. **Read first:** doc 05 (`/login` spec), doc 04 (auth conventions).

## Tasks

1. Auth.js (next-auth v5) in `apps/web`:
   - Credentials provider: look up user by email, `bcrypt.compare` against `passwordHash`.
   - JWT session strategy; put `userId`, `role`, `orgId`, `name` in the token/session
     (module augmentation for types).
   - `auth.ts` exporting `auth`, `signIn`, `signOut`, handlers wired at
     `app/api/auth/[...nextauth]/route.ts`.
2. `middleware.ts`: redirect unauthenticated visitors of `(dashboard)` routes to `/login`;
   redirect authenticated visitors of `/login` to `/`. Exclude `/api/webhooks/*` and
   `/api/v1/health` from auth entirely.
3. Server helpers in `apps/web/lib/authz.ts`:
   - `requireSession()` → session or throws `ApiError(401)`
   - `requireRole(minRole)` with ordering VIEWER < OPS < ADMIN → throws `ApiError(403)`
   - `ApiError` + `handleApiError(fn)` wrapper producing the doc-04 error envelope.
4. `/login` page per doc 05: form + three demo-persona buttons (prefill from constants +
   `SEED_DEMO_PASSWORD` exposed as `NEXT_PUBLIC_DEMO_PASSWORD` — acceptable, it's a demo org),
   error display on bad credentials, synthetic-data disclaimer line.
5. Authenticated shell skeleton: `(dashboard)/layout.tsx` with sidebar (nav items, non-functional
   count bubbles for now), topbar with user name + role badge + sign-out. Placeholder overview
   page showing "Signed in as {name} ({role})".
6. `RoleGate` client component (children render only if session role ≥ min).
7. `GET /api/v1/health` (public liveness per doc 04) — first real API route, uses the error
   wrapper, checks db + redis.
8. Commit: `feat(auth): credentials auth, roles, dashboard shell (phase 2)`.

## Acceptance criteria

- [ ] Each demo button logs in as the right persona; wrong password shows an error
- [ ] Visiting `/` signed out redirects to `/login`; signed in, `/login` redirects to `/`
- [ ] Role badge in topbar matches persona; sign-out returns to login
- [ ] `curl :3000/api/v1/health` (no session) → `{ok:true,db:true,redis:true}`
- [ ] A quick manual check: temporarily add an admin-gated test route; VIEWER session gets the
      403 envelope shape from doc 04 (remove the test route after)
