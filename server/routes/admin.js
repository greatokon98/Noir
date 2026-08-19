// admin.js
// Admin routes for NOIR: login, dashboard, leads, members, tiers, blog, settings.

const express = require('express');
const crypto = require('crypto');
const { query, get, all, run, transaction } = require('../db');
const md = require('../markdown');
const { authenticate, requireLogin, requireOwner, csrfProtection, ensureCsrf } = require('../auth');
const { createRateLimiter } = require('../store');

const router = express.Router();

const LEAD_STATUS = ['new', 'contacted', 'toured', 'converted', 'declined'];
const MEMBER_STATUS = ['active', 'paused', 'former'];
const TIME_LABEL = {
  morning: 'Morning · 06:00–12:00',
  afternoon: 'Afternoon · 12:00–17:00',
  evening: 'Evening · 17:00–21:00'
};
const SOURCE_LABEL = { tour: 'Tour request', signup: 'Membership signup' };

function likeEscape(s) {
  return String(s).replace(/[%_]/g, '\\$&');
}

// --- Rate limiter for admin login (5 attempts / minute / IP) ---------------
const loginLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 5,
  onRejected: (req, res) => {
    req.session.loginError = 'Too many attempts. Please wait a minute.';
    return res.redirect('/admin/login');
  }
});

function setFlash(req, type, message) {
  req.session.flash = { type, message };
}

function consumeFlash(req, res) {
  res.locals.flash = req.session.flash || null;
  delete req.session.flash;
}

// ---- middleware: CSRF token on every page, verified on every write ----
router.use(ensureCsrf);
router.use(csrfProtection);

/* ------------------------------- login ------------------------------- */

router.get('/login', (req, res) => {
  if (req.session.userId) return res.redirect('/admin/dashboard');
  const error = req.session.loginError;
  delete req.session.loginError;
  res.render('login', {
    title: 'Sign in — NOIR Admin',
    loginError: error,
    csrfToken: req.session.csrfToken
  });
});

router.post('/login', loginLimiter, async (req, res, next) => {
  try {
    const email = String(req.body.email || '').trim();
    const password = String(req.body.password || '');
    const admin = await authenticate(email, password);
    if (!admin) {
      req.session.loginError = 'That combination doesn\u2019t open the door.';
      return res.redirect('/admin/login');
    }
    req.session.regenerate((err) => {
      if (err) return next(err);
      req.session.userId = admin.id;
      req.session.csrfToken = crypto.randomBytes(24).toString('hex');
      res.redirect('/admin/dashboard');
    });
  } catch (err) {
    next(err);
  }
});

router.post('/logout', requireLogin, (req, res) => {
  req.session.destroy(() => {
    res.redirect('/admin/login');
  });
});

// ---- everything below requires an authenticated session ----
router.use(requireLogin);
router.use((req, res, next) => {
  consumeFlash(req, res);
  next();
});

/* ------------------------------ dashboard ---------------------------- */

router.get('/dashboard', async (req, res, next) => {
  try {
    const weekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();

    const leadsThisWeek = (await get(
      'SELECT COUNT(*)::int AS n FROM leads WHERE created_at >= $1', [weekAgo]
    )).n;

    const statusRows = await all(
      'SELECT status, COUNT(*)::int AS n FROM leads GROUP BY status'
    );
    const counts = {};
    LEAD_STATUS.forEach((s) => { counts[s] = 0; });
    statusRows.forEach((r) => { counts[r.status] = r.n; });

    const activeMembers = (await get(
      "SELECT COUNT(*)::int AS n FROM members WHERE status = 'active'"
    )).n;

    const publishedPosts = (await get(
      "SELECT COUNT(*)::int AS n FROM blog_posts WHERE status = 'published'"
    )).n;

    const totalLeads = (await get('SELECT COUNT(*)::int AS n FROM leads')).n;

    const recentLeads = await all(
      `SELECT id, name, email, preferred_time, source, status, created_at
       FROM leads ORDER BY created_at DESC LIMIT 5`
    );

    const emailAlertsRow = await get(
      "SELECT value FROM site_settings WHERE key = 'email_alerts'"
    );
    const smtpConfigured = !!(process.env.SMTP_HOST && process.env.SMTP_USER);

    res.render('dashboard', {
      title: 'Dashboard — NOIR Admin',
      pageTitle: 'Dashboard',
      pageSub: 'A quiet morning across the club',
      activeNav: 'dashboard',
      leadsThisWeek,
      counts,
      activeMembers,
      publishedPosts,
      totalLeads,
      recentLeads,
      timeLabel: TIME_LABEL,
      emailAlerts: emailAlertsRow && emailAlertsRow.value === 'true',
      smtpConfigured
    });
  } catch (err) { next(err); }
});

/* -------------------------------- leads ------------------------------ */

router.get('/leads', async (req, res, next) => {
  try {
    const filter = LEAD_STATUS.indexOf(req.query.status) !== -1 ? req.query.status : 'all';
    const q = likeEscape(String(req.query.q || '').trim().toLowerCase());

    let rows;
    if (filter === 'all' && !q) {
      rows = await all('SELECT * FROM leads ORDER BY created_at DESC');
    } else if (filter === 'all') {
      rows = await all(
        `SELECT * FROM leads
         WHERE LOWER(name) LIKE '%' || $1 || '%' ESCAPE '\\'
            OR LOWER(email) LIKE '%' || $1 || '%' ESCAPE '\\'
            OR LOWER(COALESCE(phone,'')) LIKE '%' || $1 || '%' ESCAPE '\\'
         ORDER BY created_at DESC`, [q]
      );
    } else if (!q) {
      rows = await all(
        'SELECT * FROM leads WHERE status = $1 ORDER BY created_at DESC', [filter]
      );
    } else {
      rows = await all(
        `SELECT * FROM leads
         WHERE status = $1
           AND (LOWER(name) LIKE '%' || $2 || '%' ESCAPE '\\'
             OR LOWER(email) LIKE '%' || $2 || '%' ESCAPE '\\'
             OR LOWER(COALESCE(phone,'')) LIKE '%' || $2 || '%' ESCAPE '\\')
         ORDER BY created_at DESC`, [filter, q]
      );
    }

    res.render('leads', {
      title: 'Leads — NOIR Admin',
      pageTitle: 'Leads',
      pageSub: 'Tour requests and membership inquiries',
      activeNav: 'leads',
      leads: rows,
      filter,
      q: req.query.q || '',
      leadStatuses: LEAD_STATUS,
      timeLabel: TIME_LABEL,
      sourceLabel: SOURCE_LABEL
    });
  } catch (err) { next(err); }
});

router.post('/leads', async (req, res, next) => {
  try {
    const name = String(req.body.name || '').trim();
    const email = String(req.body.email || '').trim().toLowerCase();
    const phone = String(req.body.phone || '').trim();
    const time = TIME_LABEL[req.body.preferred_time] ? req.body.preferred_time : 'morning';
    const source = req.body.source === 'signup' ? 'signup' : 'tour';
    const status = LEAD_STATUS.indexOf(req.body.status) !== -1 ? req.body.status : 'new';
    const notes = String(req.body.notes || '').trim();

    if (name.length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setFlash(req, 'error', 'Name and a valid email are required.');
      return res.redirect('/admin/leads');
    }

    const now = new Date().toISOString();
    await run(
      `INSERT INTO leads (name, email, phone, preferred_time, source, status, notes, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [name, email, phone, time, source, status, notes, now, now]
    );

    setFlash(req, 'ok', 'Lead added.');
    res.redirect('/admin/leads');
  } catch (err) { next(err); }
});

router.post('/leads/:id/status', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const status = LEAD_STATUS.indexOf(req.body.status) !== -1 ? req.body.status : null;
    if (!id || !status) {
      setFlash(req, 'error', 'Invalid status update.');
      return res.redirect('/admin/leads');
    }
    await run(
      'UPDATE leads SET status = $1, updated_at = $2 WHERE id = $3',
      [status, new Date().toISOString(), id]
    );
    setFlash(req, 'ok', 'Lead marked ' + status + '.');
    res.redirect('/admin/leads');
  } catch (err) { next(err); }
});

router.post('/leads/:id/delete', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!id) {
      setFlash(req, 'error', 'Invalid lead.');
      return res.redirect('/admin/leads');
    }
    await run('DELETE FROM leads WHERE id = $1', [id]);
    setFlash(req, 'ok', 'Lead deleted.');
    res.redirect('/admin/leads');
  } catch (err) { next(err); }
});

/* ------------------------------- members ----------------------------- */

async function tierNameMap() {
  const tiers = await all('SELECT key, name FROM membership_tiers');
  const map = {};
  tiers.forEach((t) => { map[t.key] = t.name; });
  return map;
}

router.get('/members', async (req, res, next) => {
  try {
    const q = likeEscape(String(req.query.q || '').trim().toLowerCase());
    const rows = q
      ? await all(
          `SELECT * FROM members
           WHERE LOWER(name) LIKE '%' || $1 || '%' ESCAPE '\\'
              OR LOWER(email) LIKE '%' || $1 || '%' ESCAPE '\\'
              OR LOWER(COALESCE(phone,'')) LIKE '%' || $1 || '%' ESCAPE '\\'
           ORDER BY status = 'active' DESC, joined_at DESC`, [q]
        )
      : await all('SELECT * FROM members ORDER BY status = \'active\' DESC, joined_at DESC');

    const tiers = await all('SELECT * FROM membership_tiers ORDER BY sort_order');

    res.render('members', {
      title: 'Members — NOIR Admin',
      pageTitle: 'Members',
      pageSub: 'The 420, kept current by hand',
      activeNav: 'members',
      members: rows,
      tiers,
      tierNames: await tierNameMap(),
      q: req.query.q || '',
      memberStatuses: MEMBER_STATUS
    });
  } catch (err) { next(err); }
});

router.post('/members/import', async (req, res, next) => {
  try {
    const raw = String(req.body.csv || '').trim();
    if (!raw) {
      setFlash(req, 'error', 'Paste CSV rows first.');
      return res.redirect('/admin/members');
    }

    const tierRows = await all('SELECT key FROM membership_tiers');
    const tierKeys = tierRows.map((t) => t.key);

    let added = 0;
    let skipped = 0;

    const lines = raw.split(/\r?\n/);
    for (const line of lines) {
      try {
        if (!line.trim()) continue;
        const cols = line.split(',').map((c) => c.trim().replace(/^"|"$/g, ''));
        if (cols.length < 2) continue;
        const [name, email] = cols;
        const phone = cols[2] || '';
        const tier = tierKeys.indexOf(cols[3]) !== -1 ? cols[3] : 'residence';
        const status = MEMBER_STATUS.indexOf(cols[4]) !== -1 ? cols[4] : 'active';
        const joined = /^\d{4}-\d{2}-\d{2}$/.test(cols[5] || '') ? cols[5] : new Date().toISOString().slice(0, 10);

        if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          skipped += 1;
          continue;
        }
        const exists = await get('SELECT id FROM members WHERE email = $1', [email.toLowerCase()]);
        if (exists) {
          skipped += 1;
          continue;
        }
        const now = new Date().toISOString();
        await run(
          `INSERT INTO members (name, email, phone, tier_id, status, joined_at, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [name, email.toLowerCase(), phone, tier, status, joined, now, now]
        );
        added += 1;
      } catch (_) { skipped += 1; }
    }

    setFlash(req, 'ok', 'Imported ' + added + ' member' + (added === 1 ? '' : 's') + (skipped ? ', skipped ' + skipped : '') + '.');
    res.redirect('/admin/members');
  } catch (err) { next(err); }
});

router.post('/members', async (req, res, next) => {
  try {
    const name = String(req.body.name || '').trim();
    const email = String(req.body.email || '').trim().toLowerCase();
    const phone = String(req.body.phone || '').trim();
    const tier = String(req.body.tier_id || 'residence');
    const status = MEMBER_STATUS.indexOf(req.body.status) !== -1 ? req.body.status : 'active';
    const joined = /^\d{4}-\d{2}-\d{2}$/.test(req.body.joined_at || '') ? req.body.joined_at : new Date().toISOString().slice(0, 10);
    const notes = String(req.body.notes || '').trim();

    if (name.length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setFlash(req, 'error', 'Name and a valid email are required.');
      return res.redirect('/admin/members');
    }
    const exists = await get('SELECT id FROM members WHERE email = $1', [email]);
    if (exists) {
      setFlash(req, 'error', 'A member with that email already exists.');
      return res.redirect('/admin/members');
    }
    const now = new Date().toISOString();
    await run(
      `INSERT INTO members (name, email, phone, tier_id, status, joined_at, notes, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [name, email, phone, tier, status, joined, notes, now, now]
    );

    setFlash(req, 'ok', 'Member added.');
    res.redirect('/admin/members');
  } catch (err) { next(err); }
});

router.post('/members/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const name = String(req.body.name || '').trim();
    const email = String(req.body.email || '').trim().toLowerCase();
    const phone = String(req.body.phone || '').trim();
    const tier = String(req.body.tier_id || 'residence');
    const status = MEMBER_STATUS.indexOf(req.body.status) !== -1 ? req.body.status : 'active';
    const joined = /^\d{4}-\d{2}-\d{2}$/.test(req.body.joined_at || '') ? req.body.joined_at : new Date().toISOString().slice(0, 10);
    const notes = String(req.body.notes || '').trim();

    if (!id || name.length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setFlash(req, 'error', 'Name and a valid email are required.');
      return res.redirect('/admin/members');
    }
    const dup = await get('SELECT id FROM members WHERE email = $1 AND id != $2', [email, id]);
    if (dup) {
      setFlash(req, 'error', 'Another member already uses that email.');
      return res.redirect('/admin/members');
    }
    await run(
      `UPDATE members SET name = $1, email = $2, phone = $3, tier_id = $4, status = $5, joined_at = $6, notes = $7, updated_at = $8
       WHERE id = $9`,
      [name, email, phone, tier, status, joined, notes, new Date().toISOString(), id]
    );

    setFlash(req, 'ok', 'Member saved.');
    res.redirect('/admin/members');
  } catch (err) { next(err); }
});

router.post('/members/:id/delete', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!id) {
      setFlash(req, 'error', 'Invalid member.');
      return res.redirect('/admin/members');
    }
    await run('DELETE FROM members WHERE id = $1', [id]);
    setFlash(req, 'ok', 'Member removed.');
    res.redirect('/admin/members');
  } catch (err) { next(err); }
});

/* ------------------------------- tiers ------------------------------- */

router.get('/tiers', async (req, res, next) => {
  try {
    const rows = (await all(
      'SELECT * FROM membership_tiers ORDER BY sort_order'
    )).map((t) => {
      try {
        t.features = JSON.parse(t.features_json || '[]');
      } catch (e) {
        t.features = [];
      }
      delete t.features_json;
      return t;
    });

    res.render('tiers', {
      title: 'Membership — NOIR Admin',
      pageTitle: 'Membership',
      pageSub: 'Three tiers — managed here, rendered on the site',
      activeNav: 'membership',
      tiers: rows
    });
  } catch (err) { next(err); }
});

router.post('/tiers/:id', requireOwner, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const name = String(req.body.name || '').trim();
    const rawPrice = Number(req.body.price_monthly);
    const price = req.body.price_monthly === '' || req.body.price_monthly == null
      ? null
      : Number.isFinite(rawPrice) ? Math.max(0, Math.round(rawPrice)) : null;
    const billing = String(req.body.billing_label || '').trim();
    const tagline = String(req.body.tagline || '').trim();
    const sortOrder = Math.max(1, Math.round(Number(req.body.sort_order) || 1));
    const published = req.body.published === '1';
    const features = Array.isArray(req.body.features)
      ? req.body.features.map((f) => String(f || '').trim()).filter(Boolean)
      : String(req.body.features || '').split('\n').map((f) => f.trim()).filter(Boolean);

    if (!id || !name || !billing || !tagline) {
      setFlash(req, 'error', 'Name, billing label and tagline are required.');
      return res.redirect('/admin/tiers');
    }

    await run(
      `UPDATE membership_tiers
       SET name = $1, price_monthly = $2, billing_label = $3, tagline = $4, features_json = $5, sort_order = $6, published = $7
       WHERE id = $8`,
      [name, price, billing, tagline, JSON.stringify(features), sortOrder, published, id]
    );

    setFlash(req, 'ok', 'Tier saved.');
    res.redirect('/admin/tiers');
  } catch (err) { next(err); }
});

router.post('/tiers/:id/publish', requireOwner, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const tier = await get('SELECT published FROM membership_tiers WHERE id = $1', [id]);
    if (!tier) return res.redirect('/admin/tiers');
    await run('UPDATE membership_tiers SET published = $1 WHERE id = $2', [!tier.published, id]);
    setFlash(req, 'ok', tier.published ? 'Tier hidden from the site.' : 'Tier published.');
    res.redirect('/admin/tiers');
  } catch (err) { next(err); }
});

router.post('/tiers/:id/move', requireOwner, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const dir = req.body.dir === 'up' ? -1 : 1;
    const tier = await get('SELECT id, sort_order FROM membership_tiers WHERE id = $1', [id]);
    if (!tier) return res.redirect('/admin/tiers');

    const neighbor = dir === -1
      ? await get('SELECT id, sort_order FROM membership_tiers WHERE sort_order < $1 ORDER BY sort_order DESC LIMIT 1', [tier.sort_order])
      : await get('SELECT id, sort_order FROM membership_tiers WHERE sort_order > $1 ORDER BY sort_order ASC LIMIT 1', [tier.sort_order]);
    if (!neighbor) return res.redirect('/admin/tiers');

    await transaction(async (client) => {
      await client.query('UPDATE membership_tiers SET sort_order = $1 WHERE id = $2', [neighbor.sort_order, id]);
      await client.query('UPDATE membership_tiers SET sort_order = $1 WHERE id = $2', [tier.sort_order, neighbor.id]);
    });

    setFlash(req, 'ok', 'Order updated.');
    res.redirect('/admin/tiers');
  } catch (err) { next(err); }
});

/* -------------------------------- blog ------------------------------- */

router.get('/blog', async (req, res, next) => {
  try {
    const posts = await all(
      'SELECT * FROM blog_posts ORDER BY COALESCE(published_at, updated_at) DESC'
    );
    res.render('blog', {
      title: 'Blog — NOIR Admin',
      pageTitle: 'Blog',
      pageSub: 'Journal posts, drafts and published',
      activeNav: 'blog',
      posts
    });
  } catch (err) { next(err); }
});

function slugify(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

async function postForm(req, res, post, isNew) {
  const title = String(req.body.title || '').trim();
  const slug = String(req.body.slug || '').trim() || slugify(title);
  const excerpt = String(req.body.excerpt || '').trim();
  const body = String(req.body.body || '');
  const cover = String(req.body.cover_image || '').trim();
  const status = req.body.status === 'published' ? 'published'
    : req.body.status === 'draft' ? 'draft'
    : req.body.status_select === 'published' ? 'published'
    : 'draft';

  if (!title || !slug) {
    setFlash(req, 'error', 'Title and slug are required.');
    return res.redirect(isNew ? '/admin/blog/new' : '/admin/blog/' + post.id + '/edit');
  }
  const dup = post.id
    ? await get('SELECT id FROM blog_posts WHERE slug = $1 AND id != $2', [slug, post.id])
    : await get('SELECT id FROM blog_posts WHERE slug = $1', [slug]);
  if (dup) {
    setFlash(req, 'error', 'That slug is already in use.');
    return res.redirect(isNew ? '/admin/blog/new' : '/admin/blog/' + post.id + '/edit');
  }

  const now = new Date().toISOString();
  const publishedAt = status === 'published'
    ? (post.published_at || now)
    : null;

  if (post.id) {
    await run(
      `UPDATE blog_posts
       SET slug = $1, title = $2, excerpt = $3, body_markdown = $4, cover_image = $5, status = $6, published_at = $7, updated_at = $8
       WHERE id = $9`,
      [slug, title, excerpt, body, cover, status, publishedAt, now, post.id]
    );
  } else {
    await run(
      `INSERT INTO blog_posts (slug, title, excerpt, body_markdown, cover_image, status, published_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [slug, title, excerpt, body, cover, status, publishedAt, now]
    );
  }
  setFlash(req, 'ok', status === 'published' ? 'Post published.' : 'Draft saved.');
  res.redirect('/admin/blog');
}

router.get('/blog/new', (req, res) => {
  res.render('blog-editor', {
    title: 'New post — NOIR Admin',
    pageTitle: 'New post',
    pageSub: 'Write it, preview it, publish it',
    activeNav: 'blog',
    post: { id: null, slug: '', title: '', excerpt: '', body_markdown: '', cover_image: '', status: 'draft', published_at: null },
    previewHtml: ''
  });
});

router.post('/blog', async (req, res, next) => {
  try { await postForm(req, res, { id: null, published_at: null }, true); }
  catch (err) { next(err); }
});

router.get('/blog/:id/edit', async (req, res, next) => {
  try {
    const post = await get('SELECT * FROM blog_posts WHERE id = $1', [Number(req.params.id)]);
    if (!post) return res.redirect('/admin/blog');
    res.render('blog-editor', {
      title: 'Edit post — NOIR Admin',
      pageTitle: 'Edit post',
      pageSub: '#' + post.id + ' · ' + post.slug,
      activeNav: 'blog',
      post,
      previewHtml: md.render(post.body_markdown)
    });
  } catch (err) { next(err); }
});

router.post('/blog/:id', async (req, res, next) => {
  try {
    const post = await get('SELECT * FROM blog_posts WHERE id = $1', [Number(req.params.id)]);
    if (!post) return res.redirect('/admin/blog');
    await postForm(req, res, post, false);
  } catch (err) { next(err); }
});

router.post('/blog/:id/publish', async (req, res, next) => {
  try {
    const post = await get('SELECT * FROM blog_posts WHERE id = $1', [Number(req.params.id)]);
    if (!post) return res.redirect('/admin/blog');
    if (post.status === 'published') {
      await run('UPDATE blog_posts SET status = $1, published_at = NULL, updated_at = $2 WHERE id = $3', ['draft', new Date().toISOString(), post.id]);
      setFlash(req, 'ok', 'Post unpublished.');
    } else {
      const now = new Date().toISOString();
      await run('UPDATE blog_posts SET status = $1, published_at = $2, updated_at = $3 WHERE id = $4', ['published', now, now, post.id]);
      setFlash(req, 'ok', 'Post published.');
    }
    res.redirect('/admin/blog');
  } catch (err) { next(err); }
});

router.post('/blog/:id/delete', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!id) {
      setFlash(req, 'error', 'Invalid post.');
      return res.redirect('/admin/blog');
    }
    await run('DELETE FROM blog_posts WHERE id = $1', [id]);
    setFlash(req, 'ok', 'Post deleted.');
    res.redirect('/admin/blog');
  } catch (err) { next(err); }
});

/* ------------------------------- settings ---------------------------- */

const SETTING_FIELDS = [
  ['hero_eyebrow', 'Hero eyebrow', 'Renders above the H1 on the landing page'],
  ['hero_heading', 'Hero heading', 'Main H1 heading in the hero section'],
  ['hero_lead', 'Hero lead paragraph', 'Supporting paragraph below the H1'],
  ['cta_primary_label', 'Primary CTA label', 'Solid gold button in the hero'],
  ['cta_tour_label', 'Form CTA label', 'Submit button on the tour form'],
  ['phone', 'Phone', 'tel: link and footer'],
  ['email', 'Email', 'mailto: link and footer'],
  ['hours_club', 'Club hours', 'Footer hours'],
  ['hours_concierge', 'Concierge hours', 'Footer hours and form note'],
  ['cred_1_value', 'Credential 1 number', 'Stats bar — first value'],
  ['cred_1_label', 'Credential 1 label', 'Stats bar — first label'],
  ['cred_2_value', 'Credential 2 number', 'Stats bar — second value'],
  ['cred_2_label', 'Credential 2 label', 'Stats bar — second label'],
  ['cred_3_value', 'Credential 3 number', 'Stats bar — third value'],
  ['cred_3_label', 'Credential 3 label', 'Stats bar — third label'],
  ['cred_4_value', 'Credential 4 number', 'Stats bar — fourth value'],
  ['cred_4_label', 'Credential 4 label', 'Stats bar — fourth label'],
  ['club_heading', 'Club section heading', 'H2 in the club / room section'],
  ['club_body', 'Club section body', 'First paragraph in the club section'],
  ['club_spec_1_value', 'Club spec 1 value', 'e.g. 4°C'],
  ['club_spec_1_label', 'Club spec 1 label', 'e.g. Cold plunge'],
  ['club_spec_2_value', 'Club spec 2 value', 'e.g. 12 m'],
  ['club_spec_2_label', 'Club spec 2 label', 'e.g. Open turf'],
  ['club_spec_3_value', 'Club spec 3 value', 'e.g. 6'],
  ['club_spec_3_label', 'Club spec 3 label', 'e.g. Sauna capacity'],
  ['programs_heading', 'Programs heading', 'H2 in the disciplines section'],
  ['programs_intro', 'Programs intro', 'Intro paragraph below programs heading'],
  ['program_1_title', 'Program 1 title', 'Strength & Performance'],
  ['program_1_desc', 'Program 1 description', 'Short description for program 1'],
  ['program_2_title', 'Program 2 title', 'Recovery & Longevity'],
  ['program_2_desc', 'Program 2 description', 'Short description for program 2'],
  ['program_3_title', 'Program 3 title', 'Nutrition'],
  ['program_3_desc', 'Program 3 description', 'Short description for program 3'],
  ['coaches_heading', 'Coaches heading', 'H2 in the coaches section'],
  ['coaches_intro', 'Coaches intro', 'Intro paragraph below coaches heading'],
  ['coach_1_name', 'Coach 1 name', 'First coach name'],
  ['coach_1_role', 'Coach 1 role', 'First coach role / title'],
  ['coach_1_bio', 'Coach 1 bio', 'First coach short bio'],
  ['coach_2_name', 'Coach 2 name', 'Second coach name'],
  ['coach_2_role', 'Coach 2 role', 'Second coach role / title'],
  ['coach_2_bio', 'Coach 2 bio', 'Second coach short bio'],
  ['coach_3_name', 'Coach 3 name', 'Third coach name'],
  ['coach_3_role', 'Coach 3 role', 'Third coach role / title'],
  ['coach_3_bio', 'Coach 3 bio', 'Third coach short bio'],
  ['membership_heading', 'Membership heading', 'H2 in the membership section'],
  ['testimonials_heading', 'Testimonials heading', 'H2 in the testimonials section'],
  ['testimonial_1_text', 'Testimonial 1 text', 'First quote text'],
  ['testimonial_1_attr', 'Testimonial 1 attribution', 'First quote attribution'],
  ['testimonial_2_text', 'Testimonial 2 text', 'Second quote text'],
  ['testimonial_2_attr', 'Testimonial 2 attribution', 'Second quote attribution'],
  ['testimonial_3_text', 'Testimonial 3 text', 'Third quote text'],
  ['testimonial_3_attr', 'Testimonial 3 attribution', 'Third quote attribution'],
  ['journal_heading', 'Journal heading', 'H2 in the journal section'],
  ['journal_intro', 'Journal intro', 'Intro paragraph below journal heading'],
  ['tour_heading', 'Tour section heading', 'H2 in the tour form section'],
  ['tour_body', 'Tour section body', 'Paragraph in the tour section'],
  ['tour_address', 'Tour address', 'Address line below phone/email'],
  ['footer_brand_text', 'Footer brand text', 'Footer tagline paragraph']
];

router.get('/settings', async (req, res, next) => {
  try {
    const rows = await all('SELECT key, value FROM site_settings');
    const map = {};
    rows.forEach((r) => { map[r.key] = r.value; });
    const emailAlerts = map.email_alerts === 'true';
    const smtpConfigured = !!(process.env.SMTP_HOST && process.env.SMTP_USER);

    res.render('settings', {
      title: 'Settings — NOIR Admin',
      pageTitle: 'Settings',
      pageSub: 'Editable page content and notifications',
      activeNav: 'settings',
      fields: SETTING_FIELDS.map(([key, label, hint]) => ({
        key, label, hint, value: typeof map[key] === 'string' ? map[key] : ''
      })),
      emailAlerts,
      smtpConfigured
    });
  } catch (err) { next(err); }
});

router.post('/settings', requireOwner, async (req, res, next) => {
  try {
    for (const [key] of SETTING_FIELDS) {
      const value = String(req.body[key] || '').trim();
      await run(
        `INSERT INTO site_settings (key, value) VALUES ($1, $2)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
        [key, value]
      );
    }
    const emailAlerts = req.body.email_alerts === '1' && process.env.SMTP_HOST ? 'true' : 'false';
    await run(
      `INSERT INTO site_settings (key, value) VALUES ('email_alerts', $1)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [emailAlerts]
    );

    setFlash(req, 'ok', 'Page content saved.');
    res.redirect('/admin/settings');
  } catch (err) { next(err); }
});

module.exports = router;
