# Admin Dashboard Plan — NOIR Private Fitness Club

## Intent summary

Add a **lightweight admin dashboard + database** behind the existing landing page so the club can manage what the page does and receives — without hiring a dev team or running a heavy stack.

The landing page becomes data-backed in three concrete ways:

1. **Tour requests** (the form) land in a database as leads, with a status pipeline (new → contacted → toured → converted).
2. **Membership** registration and tier data are managed in the admin, not hardcoded.
3. **Content** — CTA labels, hero eyebrow, contact info, blog posts — is editable from the dashboard instead of being baked into HTML.

**Artifact scope for the next design run:** an admin dashboard prototype (multi-screen, Luxury-styled) + this plan as the blueprint for the real codebase.

**Design system:** Luxury (unchanged) — black lacquer `#080706`, champagne gold accent `#c6a15b`, Didot / Avenir Next / mono stacks. The admin must feel like NOIR, not a generic Bootstrap admin.

---

## Goals

- Capture every form submission reliably (the current form only validates in the browser and goes nowhere).
- Give the club a simple pipeline for follow-up: see new leads, mark them contacted/toured/converted.
- Manage membership tiers + members in one place.
- Edit on-page content (CTAs, contact, hours) without touching HTML.
- Publish blog posts (admin-side authoring; page-side display is optional, see Open questions).
- **Stay light:** one process, one file-based database, no microservices, no heavy framework by default.

## Non-goals (for now)

- No payments/billing integration. Tiers are informational; invoices come later if ever.
- No public member portal / self-service login. Admin is staff-only.
- No analytics dashboards beyond basic lead/member counts.
- No multi-tenant / multi-club support.

---

## Users & roles

| Role | Needs |
|------|-------|
| Admin (concierge / GM) | Review leads, update status, add members, edit content, write posts |
| Super admin (owner) | Everything + manage admin accounts |
| Public visitor | Submits the tour form; reads the page (no login) |

Auth: **one session-based login**. `admins` table with `role` (`admin` | `owner`). Passwords bcrypt-hashed; session cookie `httpOnly`, `secure`, `SameSite=Lax`.

---

## Tech stack decision

**Recommendation: Node.js + Express + SQLite (`better-sqlite3`) + server-rendered admin pages.**

Why this is the right "something light":

- **SQLite = zero database servers.** One `noir.db` file, trivial to back up, fine for hundreds of members + thousands of leads. No Postgres to run or pay for at this scale.
- **Express = minimal, boring, well-known.** One process handles both the public API and the admin.
- **`better-sqlite3` = synchronous, typed-ish SQL, prepared statements** (SQL injection-safe by construction).
- **Server-rendered admin pages** (a tiny view layer, or HTMX for interactivity) keep the admin fast and avoid a React build step. The admin still gets the Luxury look.
- **Deploys anywhere** (Render, Fly.io, Railway, even a $5 VPS) and runs locally with one command.

### Alternatives (if you prefer)

| Stack | Good for | Cost vs. the recommendation |
|-------|----------|------------------------------|
| **Next.js + SQLite (Drizzle/Prisma)** | One unified React codebase; you want components, not server-rendered pages | More tooling, heavier build; same DB |
| **Supabase (hosted Postgres)** | Zero backend code; auth + DB + storage out of the box | Hosted dependency, subscription, vendor lock-in |
| **Cloudflare Workers + D1** | Edge speed, serverless, generous free tier | Vendor lock-in; file uploads/backups are awkward |

**Frontend:** keep `luxury-gym-landing.html` a static, CDN-deployable page. It gains two small JavaScript touches — form POST to `/api/leads` and (optionally) a `/api/settings` fetch for editable copy. No framework needed on the public page.

---

## Architecture (one diagram in words)

```
Browser ──► luxury-gym-landing.html (static, CDN)
                │  POST /api/leads         GET /api/settings (optional)
                ▼
        Node + Express app (server/)
                │  better-sqlite3
                ▼
        noir.db  (single file)
                ▲
        /admin/*  (login-protected, server-rendered, Luxury-styled)
                ▼
        Admin browser
```

## Repository layout (proposed)

```
noir/                       ← new codebase root (this is the "light" server)
├── server/
│   ├── index.js            ← Express app: public API + admin
│   ├── db.js               ← better-sqlite3 init + migrations
│   ├── schema.sql          ← table definitions (source of truth)
│   ├── auth.js             ← session + bcrypt + CSRF
│   └── routes/
│       ├── public.js       ← /api/leads, /api/settings
│       └── admin.js        ← /admin/* (login-protected CRUD)
├── views/                  ← server-rendered admin templates (Luxury-styled)
├── public/                 ← static assets for the landing page (or CDN)
├── noir.db                 ← generated (gitignored)
└── package.json
```

The landing page stays as-is (`luxury-gym-landing.html`); only its form JS changes to POST to the API.

---

## Data model (SQLite)

```sql
-- admins
admins(id, email UNIQUE, password_hash, name, role, created_at)

-- tour / membership leads (what the landing form creates)
leads(id, name, email, phone, preferred_time, source,        -- source = 'tour' | 'signup'
      status,       -- 'new' | 'contacted' | 'toured' | 'converted' | 'declined'
      notes, created_at, updated_at)

-- members (staff-managed; imported or added by hand)
members(id, name, email, phone, tier_id, status,            -- 'active' | 'paused' | 'former'
        joined_at, notes, created_at, updated_at)

-- membership tiers (renders the Membership section)
membership_tiers(id, key, name, price_monthly,              -- NULL for 'by application'
                 billing_label, tagline, features_json, sort_order, published)

-- blog
blog_posts(id, slug UNIQUE, title, excerpt, body_markdown, cover_image,
           status,  -- 'draft' | 'published'
           published_at, updated_at)

-- editable page content (CTA + contact)
site_settings(key, value)  -- e.g. hero_eyebrow, cta_primary_label,
                           -- cta_tour_label, phone, email, hours_club, hours_concierge
```

**Rules:** every admin write goes through prepared statements; `status` values constrained in code; timestamps set server-side. No user-supplied HTML is ever rendered — blog body is Markdown → sanitized HTML.

---

## Admin screens (prototype to be designed)

1. **Login** — email + password, Luxury-styled, no flashiness.
2. **Dashboard** — restrained stats: leads this week, pipeline breakdown (new / contacted / toured / converted), active members, published posts. Counts only; no fake charts.
3. **Leads** — table (name, contact, preferred time, status, created), filter by status, click → detail with status change + notes.
4. **Members** — list + add/edit/archive. Tier shown from `membership_tiers`.
5. **Membership tiers** — edit names, price, tagline, features; reorder; publish toggle. Feeds the landing page.
6. **Blog** — post list (draft/published toggle) + editor (title, slug, excerpt, Markdown body, optional cover image upload).
7. **Settings / Content** — edit hero eyebrow, CTA labels, phone/email/hours. These values render on the landing page.

Navigation: a left rail (Dashboard · Leads · Members · Membership · Blog · Settings) consistent with the Luxury visual language.

---

## Public API (minimal)

| Method | Path | Purpose | Auth |
|--------|------|---------|------|
| POST | `/api/leads` | Create a lead from the tour form | Public (honeypot + rate limit) |
| GET | `/api/settings` | Editable copy for the page | Public (read-only keys) |
| GET | `/api/blog` | Published posts | Public (only if the page gets a blog section) |

Landing page changes:
- Form `fetch POST /api/leads` with JSON; keep current client-side validation + add a hidden honeypot field + server-side validation + rate limit (e.g. 5/min per IP).
- CTA/content sections read `/api/settings` on load (fall back to baked-in values if the API is down — the page must never break offline).

---

## Security checklist

- [ ] bcrypt password hashing; never log or return hashes
- [ ] Session cookie: `httpOnly`, `secure`, `SameSite=Lax`, expiry ~24h
- [ ] CSRF token on every admin form
- [ ] Server-side validation on all public POSTs + honeypot + rate limiting
- [ ] Prepared statements everywhere (better-sqlite3)
- [ ] No secrets or DB in the repo; `noir.db` gitignored
- [ ] Admin routes: 403 unless authenticated; owner-only for admin account management

---

## Implementation phases

1. **Foundation** — `package.json`, Express app, `schema.sql` + `db.js`, auth (session + bcrypt + CSRF).
2. **Public wiring** — POST `/api/leads` + honeypot/rate limit; landing form JS update; optional `/api/settings`.
3. **Admin UI (design run)** — dashboard, leads pipeline, members, tiers, blog, settings — Luxury-styled prototype first, then real server-rendered pages.
4. **Hardening & deploy** — backups (SQLite file copy), env config, one-command deploy, smoke-test the form end-to-end.

---

## Visual direction (admin must match the brand)

- Bind Luxury tokens verbatim into the admin's `:root`; no new palette.
- Dark surfaces, champagne gold accent **max twice per screen**, Didot for page-level headings only, Avenir/mono for data.
- Data tables: hairline borders, generous row height (≥ 44px touch), no zebra-stripe noise.
- Status colors from existing tokens: `--success` (converted/active), `--warn` (contacted/toured/draft), `--danger` (declined/former).
- States: explicit `:focus-visible`, hover pairs keep contrast (never gray-out), consistent 150–250ms motion.

---

## Decisions (locked)

| Topic | Decision |
|-------|----------|
| **Blog/news on the landing page** | Yes. Add a **Journal** section (latest published posts) to the landing page. Static sample posts in the prototype; served from `/api/blog` in the real app. |
| **Email notifications** | Implement concierge alerts on new leads, but **ship inactive** — activation is gated on SMTP being configured (`SMTP_*` env). Admin Settings shows "SMTP not configured" until then. |
| **Member CSV import** | Yes. Phase 3 adds CSV import (headers: `name,email,phone,tier,status,joined`). |
| **Cover image uploads** | Local `public/uploads/` folder — fits free hosting and this scale; no object storage. |
| **Hosting (free)** | Landing page on a free static host (Netlify / Cloudflare Pages). Node + SQLite API on a free-tier host: Render free web service (note: cold-starts after ~15 min idle) or Fly.io. `noir.db` needs a persistent disk. |
| **Admins** | Single admin account at launch (seeded `owner` role). `role` column stays for future multi-admin. |

---

## Next step

Plan approved. The prototype is delivered as **`admin-dashboard.html`** — Luxury-styled, interactive, backed by demo data mirroring the schema below (login, dashboard, leads pipeline, members + CSV import, membership tiers, blog editor, settings). A later run scaffolds the real `noir/` Node + Express + SQLite codebase from the schema.
