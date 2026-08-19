// public.js
// Public API for the landing page: lead capture, editable settings, blog.

const express = require('express');
const { query, get, all, run } = require('../db');
const md = require('../markdown');
const { sendLeadAlert } = require('../mailer');
const { createRateLimiter } = require('../store');

const router = express.Router();

// ---- rate limiting (5 requests / minute / IP) ----
const apiLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 5
});

const TIME_VALUES = ['morning', 'afternoon', 'evening'];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// POST /api/leads — creates a lead from the tour form.
router.post('/leads', apiLimiter, async (req, res) => {
  try {
    const honeypot = String(req.body.company || '').trim();
    if (honeypot) {
      return res.status(201).json({ ok: true });
    }

    const name = String(req.body.name || '').trim();
    const email = String(req.body.email || '').trim().toLowerCase();
    const phone = String(req.body.phone || '').trim();
    const preferredTime = String(req.body.time || req.body.preferred_time || '').trim();
    const source = req.body.source === 'signup' ? 'signup' : 'tour';

    if (name.length < 2 || name.length > 120) {
      return res.status(400).json({ error: 'Please provide a name between 2 and 120 characters.' });
    }
    if (!EMAIL_RE.test(email)) {
      return res.status(400).json({ error: 'Please provide a valid email address.' });
    }
    if (TIME_VALUES.indexOf(preferredTime) === -1) {
      return res.status(400).json({ error: 'Please choose a preferred time.' });
    }
    if (phone && phone.length > 40) {
      return res.status(400).json({ error: 'Phone number is too long.' });
    }

    const now = new Date().toISOString();
    const info = await run(
      `INSERT INTO leads (name, email, phone, preferred_time, source, status, notes, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, 'new', '', $6, $7) RETURNING id`,
      [name, email, phone, preferredTime, source, now, now]
    );

    // Send email alert if SMTP is configured and email_alerts is enabled
    const alertSetting = await get("SELECT value FROM site_settings WHERE key = 'email_alerts'");
    if (alertSetting && alertSetting.value === 'true') {
      sendLeadAlert({ name, email, phone, preferred_time: preferredTime, source }).catch(() => {});
    }

    return res.status(201).json({ ok: true, id: info.lastInsertRowid });
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/settings — editable copy that renders on the landing page.
const PUBLIC_SETTINGS = [
  'hero_eyebrow', 'cta_primary_label', 'cta_tour_label',
  'phone', 'email', 'hours_club', 'hours_concierge'
];

router.get('/settings', async (req, res, next) => {
  try {
    const rows = await all('SELECT key, value FROM site_settings');
    const map = {};
    rows.forEach((r) => { map[r.key] = r.value; });
    const body = {};
    PUBLIC_SETTINGS.forEach((key) => {
      body[key] = typeof map[key] === 'string' ? map[key] : '';
    });
    res.json(body);
  } catch (err) {
    next(err);
  }
});

// GET /api/blog — published posts, newest first.
router.get('/blog', async (req, res, next) => {
  try {
    const posts = await all(
      `SELECT id, slug, title, excerpt, body_markdown, cover_image, published_at
       FROM blog_posts
       WHERE status = 'published' AND published_at IS NOT NULL
       ORDER BY published_at DESC`
    );
    res.json(posts.map((p) => ({
      id: p.id,
      slug: p.slug,
      title: p.title,
      excerpt: p.excerpt,
      body_html: md.render(p.body_markdown),
      cover_image: p.cover_image,
      published_at: p.published_at
    })));
  } catch (err) {
    next(err);
  }
});

// GET /api/blog/:slug — single published post by slug.
router.get('/blog/:slug', apiLimiter, async (req, res, next) => {
  try {
    const slug = String(req.params.slug || '').trim();
    if (!slug || !/^[a-z0-9-]+$/.test(slug)) {
      return res.status(400).json({ error: 'Invalid slug.' });
    }
    const post = await get(
      `SELECT id, slug, title, excerpt, body_markdown, cover_image, published_at
       FROM blog_posts
       WHERE slug = $1 AND status = 'published' AND published_at IS NOT NULL`,
      [slug]
    );
    if (!post) {
      return res.status(404).json({ error: 'Post not found.' });
    }
    return res.json({
      id: post.id,
      slug: post.slug,
      title: post.title,
      excerpt: post.excerpt,
      body_html: md.render(post.body_markdown),
      cover_image: post.cover_image,
      published_at: post.published_at
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/tiers — published membership tiers, sorted.
router.get('/tiers', async (req, res, next) => {
  try {
    const rows = await all(
      `SELECT key, name, price_monthly, billing_label, tagline, features_json
       FROM membership_tiers
       WHERE published = true
       ORDER BY sort_order ASC`
    );
    res.json(rows.map((r) => ({
      key: r.key,
      name: r.name,
      price_monthly: r.price_monthly,
      billing_label: r.billing_label,
      tagline: r.tagline,
      features: JSON.parse(r.features_json || '[]')
    })));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
