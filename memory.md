# NOIR — Project Memory

## What It Is
A members-only luxury fitness club website with:
- **Public landing page** — hero, credentials, club room, disciplines, coaches, membership tiers, testimonials, journal, tour request form
- **Admin panel** — dashboard, leads management, members, tiers, blog editor, settings
- **API** — lead capture, editable settings, blog posts, membership tiers

## Tech Stack
- **Frontend:** Single-file HTML with inline CSS/JS (`luxury-gym-landing.html`)
- **Backend:** Express.js (serverless on Vercel)
- **Database:** PostgreSQL on Neon (free tier)
- **Hosting:** Vercel (free tier) — auto-deploys from GitHub
- **Auth:** Session-based with connect-pg-simple, CSRF protection
- **Security:** Helmet CSP, rate limiter, input validation

## Live URLs
- **Site:** https://noirrr.vercel.app
- **Admin:** https://noirrr.vercel.app/admin/login
- **Credentials:** `owner@noirclub.com` / `noir2026`
- **GitHub:** https://github.com/greatokon98/Noir

## Architecture
```
/
├── server.js                    → Re-exports ./server/index (Vercel entry)
├── vercel.json                  → { "framework": "express" }
├── server/
│   ├── index.js                 → Express app, CSP, CORS, session, auto-seed
│   ├── db.js                    → PostgreSQL pool, embedded schema
│   ├── auth.js                  → connect-pg-simple, session config
│   ├── store.js                 → PostgreSQL rate limiter
│   ├── schema.sql               → DB schema
│   ├── mailer.js                → Email alerts (SMTP)
│   ├── markdown.js              → Markdown → HTML
│   └── routes/
│       ├── admin.js             → Admin CRUD (leads, members, tiers, blog, settings)
│       └── public.js            → Public API (leads, settings, blog, tiers)
├── views/                       → EJS templates (admin panel)
│   ├── dashboard.ejs
│   ├── leads.ejs
│   ├── members.ejs
│   ├── tiers.ejs
│   ├── blog.ejs / blog-editor.ejs
│   ├── settings.ejs
│   └── partials/ (head, foot, rail)
├── public/
│   ├── luxury-gym-landing.html  → Landing page (static + inline JS)
│   ├── admin.css                → Admin styles (DO NOT EDIT)
│   └── assets/                  → Images (hero, club, coaches)
```

## Database Tables
| Table | Purpose |
|-------|---------|
| `admins` | Admin accounts (owner, manager roles) |
| `leads` | Tour request form submissions |
| `members` | Member directory |
| `membership_tiers` | 3 pricing tiers (Résidence, Signature, Atelier) |
| `blog_posts` | Journal articles (markdown → HTML) |
| `site_settings` | 59 key-value pairs for all editable content |
| `sessions` | Session storage (managed by connect-pg-simple) |
| `rate_limits` | Request rate limiting |

## Dynamic Content Flow
1. Admin edits settings → saves to `site_settings` table
2. Landing page JS fetches `/api/settings` on load
3. `applySettings()` uses `SETTINGS_MAP` to find each element by CSS selector
4. Sets `innerHTML` of matching elements with the DB value
5. If API is down, the page falls back to its baked-in HTML content

## 59 Setting Keys
```
hero_eyebrow, hero_heading, hero_lead,
cta_primary_label, cta_tour_label,
phone, email, hours_club, hours_concierge,
cred_1_value/label, cred_2_value/label, cred_3_value/label, cred_4_value/label,
club_heading, club_body,
club_spec_1_value/label, club_spec_2_value/label, club_spec_3_value/label,
programs_heading, programs_intro,
program_1_title/desc, program_2_title/desc, program_3_title/desc,
coaches_heading, coaches_intro,
coach_1_name/role/bio, coach_2_name/role/bio, coach_3_name/role/bio,
membership_heading,
testimonials_heading,
testimonial_1_text/attr, testimonial_2_text/attr, testimonial_3_text/attr,
journal_heading, journal_intro,
tour_heading, tour_body, tour_address,
footer_brand_text, email_alerts
```

## Auto-Seed Data
On first cold start, seeds: 1 admin, 3 tiers, 59 settings, 3 blog posts, 5 members, 7 leads.

## Custom Rules
1. **No UI changes** — do not modify `views/*.ejs` or `public/admin.css` unless fixing non-visual bugs
2. **Original noir.zip reference** — `/var/folders/ct/.../noir-original/luxury-gym-landing.html`
3. **Landing page JS edits OK** as long as visual appearance stays identical
4. **Owner info:** Great Okon, great.okon99@gmail.com, +2348103687424

## Completed Work
- Security fixes (31 items)
- Residual fixes (8 items)
- Scalability infrastructure (rate limiter, health checks, graceful shutdown, JSON logging, Docker)
- SQLite → PostgreSQL migration
- Vercel deployment (server.js re-export, vercel.json, process.exit removal, embedded schema, session fixes)
- Auto-seed on cold start
- Dynamic content from admin (58 fields, SETTINGS_MAP, applySettings with innerHTML)
- CSP fixes (landing page + admin inline JS)
- CORS middleware fix (allow when ALLOWED_ORIGINS not configured)

## Remaining Minor Items
- POSTS hardcoded fallback blog content is empty `{}` — original had full article body text
- Email alerts toggle exists but SMTP not fully wired for lead notifications

## Key File Locations
| File | Purpose |
|------|---------|
| `server/index.js:46-76` | CSP configs (adminCsp, landingCsp) |
| `server/index.js:118-136` | CORS middleware |
| `server/index.js:166-280` | Auto-seed data |
| `server/routes/admin.js:647-706` | SETTING_FIELDS (58 fields) |
| `server/routes/public.js` | PUBLIC_SETTINGS, `/api/settings` |
| `public/luxury-gym-landing.html:1380-1460` | SETTINGS_MAP + applySettings JS |
