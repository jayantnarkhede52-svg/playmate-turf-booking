const express = require('express');
const cors = require('cors');
const path = require('path');
const { initDatabase } = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ──────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// ── Database ───────────────────────────────────
const db = initDatabase();

// ── Routes ─────────────────────────────────────
// Auth (returns router + tokenStore)
const auth = require('./routes/auth')(db);
app.use('/api/auth', auth.router);

// Players (needs tokenStore for auth checks)
const playerRoutes = require('./routes/players')(db, auth.tokenStore);
app.use('/api/players', playerRoutes);

// Bookings & Turfs
const bookingRoutes = require('./routes/bookings')(db, auth.tokenStore);
app.use('/api', bookingRoutes);

// Connections
const connectionRoutes = require('./routes/connections')(db, auth.tokenStore);
app.use('/api/connections', connectionRoutes);

// Events
const eventRoutes = require('./routes/events')(db, auth.tokenStore);
app.use('/api/events', eventRoutes);

// Chat
const chatRoutes = require('./routes/chat')(db, auth.tokenStore);
app.use('/api/chat', chatRoutes);

// ── Admin: Turf management ─────────────────────
app.post('/api/turfs', (req, res) => {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token || !auth.tokenStore.has(token)) return res.status(401).json({ error: 'Login required' });
    const playerId = auth.tokenStore.get(token);
    const player = db.prepare('SELECT is_admin FROM players WHERE id = ?').get(playerId);
    if (!player?.is_admin) return res.status(403).json({ error: 'Admin only' });

    const { name, location, price_per_hour, formats, emoji, description } = req.body;
    if (!name || !location || !price_per_hour) return res.status(400).json({ error: 'name, location, price_per_hour required' });

    const result = db.prepare('INSERT INTO turfs (name, location, price_per_hour, formats, emoji, description) VALUES (?,?,?,?,?,?)')
        .run(name, location, price_per_hour, formats || '5v5', emoji || '⚽', description || '');
    const turf = db.prepare('SELECT * FROM turfs WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json({ message: 'Turf added!', turf });
});

app.put('/api/turfs/:id', (req, res) => {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token || !auth.tokenStore.has(token)) return res.status(401).json({ error: 'Login required' });
    const playerId = auth.tokenStore.get(token);
    const player = db.prepare('SELECT is_admin FROM players WHERE id = ?').get(playerId);
    if (!player?.is_admin) return res.status(403).json({ error: 'Admin only' });

    const { name, location, price_per_hour, formats, emoji, description } = req.body;
    db.prepare(`UPDATE turfs SET name=COALESCE(?,name), location=COALESCE(?,location), price_per_hour=COALESCE(?,price_per_hour), formats=COALESCE(?,formats), emoji=COALESCE(?,emoji), description=COALESCE(?,description) WHERE id=?`)
        .run(name || null, location || null, price_per_hour || null, formats || null, emoji || null, description || null, req.params.id);
    const turf = db.prepare('SELECT * FROM turfs WHERE id = ?').get(req.params.id);
    res.json({ message: 'Turf updated!', turf });
});

app.delete('/api/turfs/:id', (req, res) => {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token || !auth.tokenStore.has(token)) return res.status(401).json({ error: 'Login required' });
    const playerId = auth.tokenStore.get(token);
    const player = db.prepare('SELECT is_admin FROM players WHERE id = ?').get(playerId);
    if (!player?.is_admin) return res.status(403).json({ error: 'Admin only' });

    db.prepare('DELETE FROM turfs WHERE id = ?').run(req.params.id);
    res.json({ message: 'Turf deleted' });
});

// ── Admin: Stats ───────────────────────────────
app.get('/api/admin/stats', (req, res) => {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token || !auth.tokenStore.has(token)) return res.status(401).json({ error: 'Login required' });
    const playerId = auth.tokenStore.get(token);
    const player = db.prepare('SELECT is_admin FROM players WHERE id = ?').get(playerId);
    if (!player?.is_admin) return res.status(403).json({ error: 'Admin only' });

    const totalPlayers = db.prepare('SELECT COUNT(*) as c FROM players WHERE is_admin = 0').get().c;
    const totalBookings = db.prepare('SELECT COUNT(*) as c FROM bookings WHERE status = ?').get('confirmed').c;
    const totalConnections = db.prepare('SELECT COUNT(*) as c FROM connections').get().c;
    const pendingConnections = db.prepare("SELECT COUNT(*) as c FROM connections WHERE status = 'pending'").get().c;
    const totalTurfs = db.prepare('SELECT COUNT(*) as c FROM turfs').get().c;
    const totalEvents = db.prepare('SELECT COUNT(*) as c FROM events').get().c;
    const openEvents = db.prepare("SELECT COUNT(*) as c FROM events WHERE status = 'open'").get().c;

    res.json({ totalPlayers, totalBookings, totalConnections, pendingConnections, totalTurfs, totalEvents, openEvents });
});

// ── Health Check ───────────────────────────────
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ── Start ──────────────────────────────────────
app.listen(PORT, () => {
    console.log(`
    ⚽ ═══════════════════════════════════════
       PlayMate Server running!
       Local:  http://localhost:${PORT}
       API:    http://localhost:${PORT}/api
    ═══════════════════════════════════════ ⚽
    `);
});
