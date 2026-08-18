// seed.js
// Seeds the database with default data and a default owner account (PostgreSQL)

const bcrypt = require('bcryptjs');
const { pool, ensureSchema, run, get } = require('./db');

function daysAgo(n, hour) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  if (hour !== undefined) d.setHours(hour, 0, 0, 0);
  return d.toISOString();
}

async function runSeed() {
  await ensureSchema();
  console.log('Seeding database with default data...');

  // 1. Clean existing tables
  await pool.query('DELETE FROM admins');
  await pool.query('DELETE FROM leads');
  await pool.query('DELETE FROM members');
  await pool.query('DELETE FROM membership_tiers');
  await pool.query('DELETE FROM blog_posts');
  await pool.query('DELETE FROM site_settings');

  // 2. Create default owner admin
  const adminEmail = process.env.ADMIN_EMAIL || 'owner@noirclub.com';
  const adminPassword = process.env.ADMIN_PASSWORD || 'noir2026';
  const passwordHash = await bcrypt.hash(adminPassword, 10);
  await run(
    `INSERT INTO admins (email, password_hash, name, role) VALUES ($1, $2, $3, $4)`,
    [adminEmail, passwordHash, 'Owner', 'owner']
  );

  // 3. Seed membership tiers
  const tiers = [
    {
      key: 'residence', name: 'Résidence', price_monthly: 295, billing_label: '/ month',
      tagline: 'Full access, 06:00–23:00. Your programming, checked monthly.',
      features: ['Full club access', 'Programming checked monthly', 'Recovery suite, standard booking'],
      sort_order: 1, published: true
    },
    {
      key: 'signature', name: 'Signature', price_monthly: 495, billing_label: '/ month',
      tagline: 'Full access, a weekly 1:1 session, priority recovery booking.',
      features: ['Full club access, 24/7 by key card', 'One 1:1 session per week', 'Priority recovery booking', 'Quarterly nutrition review'],
      sort_order: 2, published: true
    },
    {
      key: 'atelier', name: 'Atelier', price_monthly: null, billing_label: 'By application',
      tagline: 'Fully bespoke. Your coach, your schedule, the room to yourself when you need it.',
      features: ['Dedicated lead coach', 'Private room access on request', 'Concierge scheduling, 06:00–21:00'],
      sort_order: 3, published: true
    }
  ];

  for (const t of tiers) {
    await run(
      `INSERT INTO membership_tiers (key, name, price_monthly, billing_label, tagline, features_json, sort_order, published)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [t.key, t.name, t.price_monthly, t.billing_label, t.tagline, JSON.stringify(t.features), t.sort_order, t.published]
    );
  }

  // 4. Seed members
  const members = [
    { name: 'M. Ferreira', email: 'mf@example.com', phone: '+1 (718) 555-0166', tier_id: 'signature', status: 'active', joined_at: '2026-01-28' },
    { name: 'G. Antonelli', email: 'ga@example.com', phone: '+1 (212) 555-0189', tier_id: 'residence', status: 'active', joined_at: '2025-11-04' },
    { name: 'R. Beaumont', email: 'rb@example.com', phone: '+1 (917) 555-0155', tier_id: 'atelier', status: 'active', joined_at: '2024-06-19' },
    { name: 'H. Okafor', email: 'ho@example.com', phone: '+1 (646) 555-0137', tier_id: 'signature', status: 'paused', joined_at: '2025-03-12' },
    { name: 'P. Larsson', email: 'pl@example.com', phone: '+1 (212) 555-0161', tier_id: 'residence', status: 'former', joined_at: '2023-09-01' }
  ];

  for (const m of members) {
    await run(
      `INSERT INTO members (name, email, phone, tier_id, status, joined_at) VALUES ($1, $2, $3, $4, $5, $6)`,
      [m.name, m.email, m.phone, m.tier_id, m.status, m.joined_at]
    );
  }

  // 5. Seed leads
  const leads = [
    { name: 'J. Mercier', email: 'jm@example.com', phone: '+1 (212) 555-0142', preferred_time: 'morning', source: 'tour', status: 'new', notes: '', created_at: daysAgo(0, 9) },
    { name: 'A. Reinholt', email: 'ar@example.com', phone: '+1 (917) 555-0198', preferred_time: 'evening', source: 'tour', status: 'new', notes: 'Asked about Signature tier.', created_at: daysAgo(1, 14) },
    { name: 'D. Calloway', email: 'dc@example.com', phone: '+1 (646) 555-0104', preferred_time: 'afternoon', source: 'signup', status: 'contacted', notes: 'Sent program overview.', created_at: daysAgo(2, 11) },
    { name: 'K. Osei', email: 'ko@example.com', phone: '+1 (212) 555-0177', preferred_time: 'morning', source: 'tour', status: 'contacted', notes: '', created_at: daysAgo(4, 8) },
    { name: 'S. Lindqvist', email: 'sl@example.com', phone: '+1 (929) 555-0123', preferred_time: 'evening', source: 'tour', status: 'toured', notes: 'Tour on Thursday, 19:00.', created_at: daysAgo(6, 16) },
    { name: 'M. Ferreira', email: 'mf@example.com', phone: '+1 (718) 555-0166', preferred_time: 'afternoon', source: 'tour', status: 'converted', notes: 'Signed Signature — started weekly 1:1.', created_at: daysAgo(9, 10) },
    { name: 'T. Nakamura', email: 'tn@example.com', phone: '+1 (212) 555-0118', preferred_time: 'morning', source: 'tour', status: 'declined', notes: 'Timing not right; revisit in Q3.', created_at: daysAgo(12, 9) }
  ];

  for (const l of leads) {
    await run(
      `INSERT INTO leads (name, email, phone, preferred_time, source, status, notes, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [l.name, l.email, l.phone, l.preferred_time, l.source, l.status, l.notes, l.created_at, l.created_at]
    );
  }

  // 6. Seed blog posts
  const posts = [
    {
      slug: 'why-we-test-every-six-weeks', title: 'Why we test every six weeks',
      excerpt: "Numbers you can defend beat goals you can't. What the retest tells us — and what it doesn't.",
      body_markdown: `## Numbers you can defend\n\nEvery six weeks we re-run the same five lifts. Not because the number is the point, but because it is honest.\n\n**What the retest tells us:** whether the last block actually moved the needle.\n\nWhat it does not tell us is everything else. Sleep, stress, the week you had. We read the number, then we read the context.`,
      status: 'published', cover_image: '', published_at: daysAgo(2, 7)
    },
    {
      slug: 'the-plunge-is-a-skill', title: 'The plunge is a skill',
      excerpt: 'Four degrees is not a punishment. It is a practice with a technique — and you can learn it.',
      body_markdown: `## Four degrees is not a punishment\n\nThe plunge is not a dare. It is a skill with an entry point and a progression, and it responds to practice the same way a squat does.\n\nStart warm. Breathe. Build time in increments, not heroics. **The goal is to come back.**`,
      status: 'published', cover_image: '', published_at: daysAgo(9, 7)
    },
    {
      slug: 'food-for-your-actual-week', title: 'Food for your actual week',
      excerpt: 'A nutrition plan fails when it assumes a perfect week. So we write for the week you actually have.',
      body_markdown: `## Write for the week you have\n\nTravel, dinners, the morning you forget to eat. The plan that survives is the one built around those — not around a fantasy schedule.\n\n*It is not about willpower. It is about structure.*`,
      status: 'draft', cover_image: '', published_at: null
    }
  ];

  for (const p of posts) {
    await run(
      `INSERT INTO blog_posts (slug, title, excerpt, body_markdown, cover_image, status, published_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [p.slug, p.title, p.excerpt, p.body_markdown, p.cover_image, p.status, p.published_at, p.published_at]
    );
  }

  // 7. Seed site settings
  const settings = {
    hero_eyebrow: 'Private fitness club — New York',
    cta_primary_label: 'Book a private tour',
    cta_tour_label: 'Request my tour',
    phone: '+1 (212) 555-0130',
    email: 'hello@noirclub.com',
    hours_club: '06:00–23:00',
    hours_concierge: '06:00–21:00',
    email_alerts: 'false'
  };

  for (const [key, value] of Object.entries(settings)) {
    await run(
      `INSERT INTO site_settings (key, value) VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [key, value]
    );
  }

  console.log('Database seeded successfully.');
}

// Run if called directly (not imported)
if (require.main === module) {
  runSeed().catch(err => {
    console.error('Error seeding database:', err);
    process.exit(1);
  });
}

module.exports = { runSeed };
