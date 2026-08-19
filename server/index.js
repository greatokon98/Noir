// index.js
// Express app: public API + Luxury-styled server-rendered admin.

require('dotenv').config();

const path = require('path');
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const { ensureSchema } = require('./db');

const { sessionConfig } = require('./auth');
const publicRoutes = require('./routes/public');
const adminRoutes = require('./routes/admin');

const app = express();
const PORT = process.env.PORT || 3000;

app.disable('x-powered-by');
app.set('trust proxy', 1);

// --- Request logging (production) -------------------------------------------
if (process.env.NODE_ENV === 'production') {
  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      const duration = Date.now() - start;
      const entry = {
        ts: new Date().toISOString(),
        method: req.method,
        path: req.path,
        status: res.statusCode,
        ms: duration,
        ip: req.ip
      };
      if (res.statusCode >= 500) {
        console.error(JSON.stringify(entry));
      } else {
        console.log(JSON.stringify(entry));
      }
    });
    next();
  });
}

// --- CSP: per-route policies ------------------------------------------------
const adminCsp = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:'],
      fontSrc: ["'self'"],
      connectSrc: ["'self'"],
      frameAncestors: ["'none'"],
      objectSrc: ["'none'"]
    }
  },
  crossOriginEmbedderPolicy: false
});
const landingCsp = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      imgSrc: ["'self'", 'data:'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      connectSrc: ["'self'"],
      frameAncestors: ["'none'"],
      objectSrc: ["'none'"]
    }
  },
  crossOriginEmbedderPolicy: false
});

app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}));

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '../views'));

app.use(express.json({ limit: '32kb' }));
app.use(express.urlencoded({ extended: false, limit: '32kb' }));

// Session middleware — wrapped to survive store/DB failures on cold start
const sess = session(sessionConfig);
app.use((req, res, next) => {
  sess(req, res, (err) => {
    if (err) {
      console.error('Session middleware error:', err.message);
      req.session = {};
    }
    next();
  });
});

// Vercel serves static from public/ — express.static used for local dev only
app.use(express.static(path.join(__dirname, '../public')));

// --- Health check endpoints -------------------------------------------------
app.get('/healthz', (req, res) => {
  res.status(200).json({ status: 'ok', uptime: process.uptime() });
});

app.get('/readyz', async (req, res) => {
  try {
    const { pool } = require('./db');
    await pool.query('SELECT 1');
    res.status(200).json({ status: 'ready', db: 'ok', uptime: process.uptime() });
  } catch (err) {
    res.status(503).json({ status: 'not ready', db: 'error', error: err.message });
  }
});

// --- CORS: configurable origins ---------------------------------------------
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',').map(s => s.trim()).filter(Boolean);

app.use('/api', (req, res, next) => {
  const origin = req.headers.origin;
  if (allowedOrigins.length > 0 && origin) {
    if (allowedOrigins.indexOf(origin) !== -1) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    } else {
      return res.status(403).json({ error: 'Cross-origin requests not allowed.' });
    }
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
app.use('/api', publicRoutes);

// Admin CSP applied per-route
app.use('/admin', adminCsp, adminRoutes);

// Landing page — served from public/ on Vercel, or from root in dev
app.get('/', landingCsp, (req, res) => {
  res.sendFile(path.join(__dirname, '../public/luxury-gym-landing.html'));
});

// 404 for unknown API routes
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// 404 for unknown admin pages
app.use((req, res) => {
  res.status(404).send('Not found.');
});

// Central error handler
app.use((err, req, res, next) => {
  console.error(err);
  if (req.path.startsWith('/api/')) {
    return res.status(500).json({ error: 'Internal server error' });
  }
  res.status(500).send('Something went wrong on our side.');
});

// --- Schema init + auto-seed (idempotent — runs on all environments) ----------
ensureSchema().then(async () => {
  try {
    const { get, run } = require('./db');
    const bcrypt = require('bcryptjs');
    const existing = await get('SELECT id FROM admins LIMIT 1');
    if (existing) return;
    console.log('No admin found — seeding default data...');
    const adminEmail = process.env.ADMIN_EMAIL || 'owner@noirclub.com';
    const adminPassword = process.env.ADMIN_PASSWORD || 'noir2026';
    const passwordHash = await bcrypt.hash(adminPassword, 10);
    await run(
      `INSERT INTO admins (email, password_hash, name, role) VALUES ($1, $2, $3, $4) ON CONFLICT (email) DO NOTHING`,
      [adminEmail, passwordHash, 'Owner', 'owner']
    );
    const tiers = [
      ['residence', 'Résidence', 295, '/ month', 'Full access, 06:00–23:00. Your programming, checked monthly.', JSON.stringify(['Full club access', 'Programming checked monthly', 'Recovery suite, standard booking']), 1, true],
      ['signature', 'Signature', 495, '/ month', 'Full access, a weekly 1:1 session, priority recovery booking.', JSON.stringify(['Full club access, 24/7 by key card', 'One 1:1 session per week', 'Priority recovery booking', 'Quarterly nutrition review']), 2, true],
      ['atelier', 'Atelier', null, 'By application', 'Fully bespoke. Your coach, your schedule, the room to yourself when you need it.', JSON.stringify(['Dedicated lead coach', 'Private room access on request', 'Concierge scheduling, 06:00–21:00']), 3, true]
    ];
    for (const t of tiers) {
      await run(
        `INSERT INTO membership_tiers (key, name, price_monthly, billing_label, tagline, features_json, sort_order, published)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (key) DO NOTHING`, t
      );
    }
    const settings = {
      hero_eyebrow: 'Private fitness club — New York',
      hero_heading: 'A training club. Not a gym.',
      hero_lead: 'One room. Forty-two members. No classes, no crowds, no noise — just the time and attention your body has been waiting for.',
      cta_primary_label: 'Book a private tour',
      cta_tour_label: 'Request my tour',
      phone: '+1 (212) 555-0130',
      email: 'hello@noirclub.com',
      hours_club: '06:00–23:00',
      hours_concierge: '06:00–21:00',
      cred_1_value: '2016', cred_1_label: 'Private by design',
      cred_2_value: '8,400 sq ft', cred_2_label: 'One open room',
      cred_3_value: '420', cred_3_label: 'Member cap',
      cred_4_value: '1 : 12', cred_4_label: 'Coach to member',
      club_heading: 'Built for the long body.',
      club_body: 'The room is simple on purpose. European oak, matte steel, a skylight that changes the mood with the hour. Every surface chosen because it rewards repetition — not because it photographs well.',
      club_spec_1_value: '4°C', club_spec_1_label: 'Cold plunge',
      club_spec_2_value: '12 m', club_spec_2_label: 'Open turf',
      club_spec_3_value: '6', club_spec_3_label: 'Sauna capacity',
      programs_heading: 'Three disciplines. No clutter.',
      programs_intro: 'No class timetable. No obstacles between you and the floor. Just three spaces, each designed for one thing done properly.',
      program_1_title: 'Strength & Performance',
      program_1_desc: 'Twelve platforms, Eleiko barbells, calibrated plates. A floor built for lifters who know what they are doing.',
      program_2_title: 'Recovery & Longevity',
      program_2_desc: 'Four-second plunge. Infrared and Finnish saunas. Normatec, Hyperice, and a cold tiled room that makes doing nothing feel deliberate.',
      program_3_title: 'Nutrition',
      program_3_desc: 'A consultation kitchen. Calibrated scales, InBody readings, and a nutritionist who writes plans by hand.',
      coaches_heading: 'Hired slowly. Kept for years.',
      coaches_intro: 'Twelve coaches. Each hired for craft and patience in equal measure.',
      coach_1_name: 'Marcus Bell', coach_1_role: 'Head of Strength',
      coach_1_bio: 'Fifteen years on the platform. Still reviews every program he signs.',
      coach_2_name: 'Elena Vasquez', coach_2_role: 'Director of Recovery',
      coach_2_bio: 'CSCS, and a working breathwork practice. She teaches the plunge like it\'s a skill — because it is.',
      coach_3_name: 'David Okafor', coach_3_role: 'Performance Nutrition',
      coach_3_bio: 'M.S., R.D. Writes plans in person, not by form.',
      membership_heading: 'Three ways in. One door.',
      testimonials_heading: 'What members say.',
      testimonial_1_text: 'Noir is the only place in New York where I can think clearly for an hour.',
      testimonial_1_attr: ' Member since 2019',
      testimonial_2_text: 'They do the small things most gyms never think about. Lighting, temperature, music — all perfect.',
      testimonial_2_attr: ' Member since 2021',
      testimonial_3_text: 'The plank is a skill, not a punishment. I finally understand that here.',
      testimonial_3_attr: ' Member since 2022',
      journal_heading: 'Notes worth reading.',
      journal_intro: 'Short reads on strength, recovery, and the long game.',
      tour_heading: 'Visit us.',
      tour_body: 'New York, NY — by appointment. We show the room when it\'s empty so you can feel the difference.',
      tour_address: 'New York, NY — by appointment',
      footer_brand_text: 'New York — by appointment',
      email_alerts: 'false'
    };
    for (const [key, value] of Object.entries(settings)) {
      await run(
        `INSERT INTO site_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
        [key, value]
      );
    }

    // Seed sample blog posts
    const now = new Date();
    function daysAgo(n, h) { const d = new Date(now); d.setDate(d.getDate() - n); if (h !== undefined) d.setHours(h, 0, 0, 0); return d.toISOString(); }
    const blogPosts = [
      {
        slug: 'why-we-test-every-six-weeks', title: 'Why we test every six weeks',
        excerpt: "Numbers you can defend beat goals you can't. What the retest tells us — and what it doesn't.",
        body: "## Numbers you can defend\n\nEvery six weeks we re-run the same five lifts. Not because the number is the point, but because it is honest.\n\n**What the retest tells us:** whether the last block actually moved the needle.\n\nWhat it does not tell us is everything else. Sleep, stress, the week you had. We read the number, then we read the context.",
        status: 'published', published_at: daysAgo(2, 7)
      },
      {
        slug: 'the-plunge-is-a-skill', title: 'The plunge is a skill',
        excerpt: 'Four degrees is not a punishment. It is a practice with a technique — and you can learn it.',
        body: "## Four degrees is not a punishment\n\nThe plunge is not a dare. It is a skill with an entry point and a progression, and it responds to practice the same way a squat does.\n\nStart warm. Breathe. Build time in increments, not heroics. **The goal is to come back.**",
        status: 'published', published_at: daysAgo(9, 7)
      },
      {
        slug: 'food-for-your-actual-week', title: 'Food for your actual week',
        excerpt: 'A nutrition plan fails when it assumes a perfect week. So we write for the week you actually have.',
        body: "## Write for the week you have\n\nTravel, dinners, the morning you forget to eat. The plan that survives is the one built around those — not around a fantasy schedule.\n\n*It is not about willpower. It is about structure.*",
        status: 'published', published_at: daysAgo(20, 7)
      }
    ];
    for (const p of blogPosts) {
      await run(
        `INSERT INTO blog_posts (slug, title, excerpt, body_markdown, cover_image, status, published_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (slug) DO NOTHING`,
        [p.slug, p.title, p.excerpt, p.body, '', p.status, p.published_at, p.published_at]
      );
    }

    // Seed sample members
    const members = [
      { name: 'M. Ferreira', email: 'mf@example.com', phone: '+1 (718) 555-0166', tier_id: 'signature', status: 'active', joined_at: '2026-01-28' },
      { name: 'G. Antonelli', email: 'ga@example.com', phone: '+1 (212) 555-0189', tier_id: 'residence', status: 'active', joined_at: '2025-11-04' },
      { name: 'R. Beaumont', email: 'rb@example.com', phone: '+1 (917) 555-0155', tier_id: 'atelier', status: 'active', joined_at: '2024-06-19' },
      { name: 'H. Okafor', email: 'ho@example.com', phone: '+1 (646) 555-0137', tier_id: 'signature', status: 'paused', joined_at: '2025-03-12' },
      { name: 'P. Larsson', email: 'pl@example.com', phone: '+1 (212) 555-0161', tier_id: 'residence', status: 'former', joined_at: '2023-09-01' }
    ];
    for (const m of members) {
      await run(
        `INSERT INTO members (name, email, phone, tier_id, status, joined_at, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (email) DO NOTHING`,
        [m.name, m.email, m.phone, m.tier_id, m.status, m.joined_at, new Date().toISOString(), new Date().toISOString()]
      );
    }

    // Seed sample leads
    const leads = [
      { name: 'J. Mercier', email: 'jm@example.com', phone: '+1 (212) 555-0142', preferred_time: 'morning', source: 'tour', status: 'new', notes: '', created_at: daysAgo(0, 9) },
      { name: 'A. Reinholt', email: 'ar@example.com', phone: '+1 (917) 555-0198', preferred_time: 'evening', source: 'tour', status: 'new', notes: 'Asked about Signature tier.', created_at: daysAgo(1, 14) },
      { name: 'D. Calloway', email: 'dc@example.com', phone: '+1 (646) 555-0104', preferred_time: 'afternoon', source: 'signup', status: 'contacted', notes: 'Sent program overview.', created_at: daysAgo(2, 11) },
      { name: 'K. Osei', email: 'ko@example.com', phone: '+1 (212) 555-0177', preferred_time: 'morning', source: 'tour', status: 'contacted', notes: '', created_at: daysAgo(4, 8) },
      { name: 'S. Lindqvist', email: 'sl@example.com', phone: '+1 (929) 555-0123', preferred_time: 'evening', source: 'tour', status: 'toured', notes: 'Tour on Thursday, 19:00.', created_at: daysAgo(6, 16) },
      { name: 'M. Ferreira', email: 'mf2@example.com', phone: '+1 (718) 555-0166', preferred_time: 'afternoon', source: 'tour', status: 'converted', notes: 'Signed Signature.', created_at: daysAgo(9, 10) },
      { name: 'T. Nakamura', email: 'tn@example.com', phone: '+1 (212) 555-0118', preferred_time: 'morning', source: 'tour', status: 'declined', notes: 'Timing not right; revisit in Q3.', created_at: daysAgo(12, 9) }
    ];
    for (const l of leads) {
      await run(
        `INSERT INTO leads (name, email, phone, preferred_time, source, status, notes, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [l.name, l.email, l.phone, l.preferred_time, l.source, l.status, l.notes, l.created_at, l.created_at]
      );
    }

    console.log('Default data seeded successfully.');
  } catch (err) {
    console.error('Auto-seed failed:', err.message);
  }
}).catch((err) => {
  console.error('Schema init failed:', err.message);
});

// --- Server startup ---------------------------------------------------------
// On Vercel: app is exported as a serverless function (no listen needed).
// Locally: app.listen for development.
if (!process.env.VERCEL) {
  process.on('unhandledRejection', (err) => {
    console.error('Unhandled rejection:', err);
  });
  process.on('uncaughtException', (err) => {
    console.error('Uncaught exception:', err);
    process.exit(1);
  });

  let server;
  let isShuttingDown = false;

  function shutdown(signal) {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.log(`\n${signal} received — shutting down gracefully...`);
    if (server) {
      server.close(() => {
        console.log('HTTP server closed.');
        process.exit(0);
      });
      setTimeout(() => {
        console.error('Forced shutdown after timeout.');
        process.exit(1);
      }, 10000).unref();
    } else {
      process.exit(0);
    }
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  ensureSchema().then(() => {
    server = app.listen(PORT, () => {
      console.log(`NOIR admin + API running at http://localhost:${PORT}`);
    });
  }).catch((err) => {
    console.error('Failed to initialize database:', err.message);
  });
}

module.exports = app;
