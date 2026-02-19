const express = require('express');
const router = express.Router();

module.exports = function (db, tokenStore) {

    function getPlayerId(req) {
        const token = req.headers.authorization?.replace('Bearer ', '');
        if (!token || !tokenStore.has(token)) return null;
        return tokenStore.get(token);
    }

    // ── GET /api/events — List upcoming open events ───
    router.get('/', (req, res) => {
        try {
            const events = db.prepare(`
                SELECT e.*, 
                    p.name as host_name, p.zone as host_zone, p.skill_level as host_skill,
                    t.name as turf_name, t.location as turf_location, t.emoji as turf_emoji
                FROM events e
                JOIN players p ON e.host_id = p.id
                LEFT JOIN turfs t ON e.turf_id = t.id
                WHERE e.status = 'open' AND (e.date > date('now') OR (e.date = date('now') AND e.time >= time('now','localtime')))
                ORDER BY e.date ASC, e.time ASC
            `).all();

            // Attach player list to each event
            const stmtPlayers = db.prepare(`
                SELECT ep.*, p.name, p.position, p.skill_level 
                FROM event_players ep JOIN players p ON ep.player_id = p.id 
                WHERE ep.event_id = ?
            `);

            events.forEach(ev => {
                ev.players = stmtPlayers.all(ev.id);
                ev.spots_left = ev.total_slots - ev.filled_slots;
            });

            res.json(events);
        } catch (err) {
            console.error('List events error:', err);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    // ── GET /api/events/:id — Event details ───
    router.get('/:id', (req, res) => {
        try {
            const event = db.prepare(`
                SELECT e.*, 
                    p.name as host_name, p.zone as host_zone, p.skill_level as host_skill,
                    t.name as turf_name, t.location as turf_location, t.emoji as turf_emoji
                FROM events e
                JOIN players p ON e.host_id = p.id
                LEFT JOIN turfs t ON e.turf_id = t.id
                WHERE e.id = ?
            `).get(req.params.id);

            if (!event) return res.status(404).json({ error: 'Event not found' });

            event.players = db.prepare(`
                SELECT ep.*, p.name, p.position, p.skill_level 
                FROM event_players ep JOIN players p ON ep.player_id = p.id 
                WHERE ep.event_id = ?
            `).all(event.id);
            event.spots_left = event.total_slots - event.filled_slots;

            res.json(event);
        } catch (err) {
            console.error('Event detail error:', err);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    // ── POST /api/events — Host a new event ───
    router.post('/', (req, res) => {
        try {
            const hostId = getPlayerId(req);
            if (!hostId) return res.status(401).json({ error: 'Login required' });

            const { turf_id, title, format, date, time, total_slots, description } = req.body;
            if (!title || !date || !time || !total_slots) {
                return res.status(400).json({ error: 'title, date, time, total_slots required' });
            }
            if (total_slots < 2 || total_slots > 22) {
                return res.status(400).json({ error: 'total_slots must be 2-22' });
            }

            const result = db.prepare(`
                INSERT INTO events (host_id, turf_id, title, format, date, time, total_slots, filled_slots, description)
                VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
            `).run(hostId, turf_id || null, title, format || '5v5', date, time, parseInt(total_slots), description || '');

            // Auto-add host as first player
            db.prepare('INSERT INTO event_players (event_id, player_id, role) VALUES (?, ?, ?)')
                .run(result.lastInsertRowid, hostId, 'host');

            const event = db.prepare('SELECT * FROM events WHERE id = ?').get(result.lastInsertRowid);
            res.status(201).json({ message: 'Event created! 🎉', event });
        } catch (err) {
            console.error('Create event error:', err);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    // ── POST /api/events/:id/join — Join an event ───
    router.post('/:id/join', (req, res) => {
        try {
            const playerId = getPlayerId(req);
            if (!playerId) return res.status(401).json({ error: 'Login required' });

            const event = db.prepare('SELECT * FROM events WHERE id = ?').get(req.params.id);
            if (!event) return res.status(404).json({ error: 'Event not found' });
            if (event.status !== 'open') return res.status(400).json({ error: 'Event is not open' });
            if (event.filled_slots >= event.total_slots) return res.status(400).json({ error: 'Event is full!' });

            // Check if already joined
            const existing = db.prepare('SELECT * FROM event_players WHERE event_id = ? AND player_id = ?')
                .get(req.params.id, playerId);
            if (existing) return res.status(409).json({ error: 'Already joined this event' });

            db.prepare('INSERT INTO event_players (event_id, player_id) VALUES (?, ?)').run(req.params.id, playerId);
            const newFilled = event.filled_slots + 1;
            const newStatus = newFilled >= event.total_slots ? 'full' : 'open';
            db.prepare('UPDATE events SET filled_slots = ?, status = ? WHERE id = ?').run(newFilled, newStatus, req.params.id);

            res.json({ message: 'Joined the game! 🙌', filled_slots: newFilled, total_slots: event.total_slots });
        } catch (err) {
            console.error('Join event error:', err);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    // ── POST /api/events/:id/leave — Leave an event ───
    router.post('/:id/leave', (req, res) => {
        try {
            const playerId = getPlayerId(req);
            if (!playerId) return res.status(401).json({ error: 'Login required' });

            const event = db.prepare('SELECT * FROM events WHERE id = ?').get(req.params.id);
            if (!event) return res.status(404).json({ error: 'Event not found' });
            if (event.host_id === playerId) return res.status(400).json({ error: 'Host cannot leave — cancel the event instead' });

            const result = db.prepare('DELETE FROM event_players WHERE event_id = ? AND player_id = ?')
                .run(req.params.id, playerId);
            if (result.changes === 0) return res.status(404).json({ error: 'You are not in this event' });

            db.prepare("UPDATE events SET filled_slots = filled_slots - 1, status = 'open' WHERE id = ?").run(req.params.id);
            res.json({ message: 'Left the event' });
        } catch (err) {
            console.error('Leave event error:', err);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    // ── PUT /api/events/:id/cancel — Cancel event (host only) ───
    router.put('/:id/cancel', (req, res) => {
        try {
            const playerId = getPlayerId(req);
            if (!playerId) return res.status(401).json({ error: 'Login required' });

            const event = db.prepare('SELECT * FROM events WHERE id = ?').get(req.params.id);
            if (!event) return res.status(404).json({ error: 'Event not found' });

            const player = db.prepare('SELECT is_admin FROM players WHERE id = ?').get(playerId);
            if (event.host_id !== playerId && !player?.is_admin) {
                return res.status(403).json({ error: 'Only host or admin can cancel' });
            }

            db.prepare("UPDATE events SET status = 'cancelled' WHERE id = ?").run(req.params.id);
            res.json({ message: 'Event cancelled' });
        } catch (err) {
            console.error('Cancel event error:', err);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    // ── GET /api/events/my — My events (hosted + joined) ───
    router.get('/my/list', (req, res) => {
        try {
            const playerId = getPlayerId(req);
            if (!playerId) return res.status(401).json({ error: 'Login required' });

            const hosted = db.prepare(`
                SELECT e.*, t.name as turf_name, t.emoji as turf_emoji
                FROM events e LEFT JOIN turfs t ON e.turf_id = t.id
                WHERE e.host_id = ?
                ORDER BY e.date DESC
            `).all(playerId);

            const joined = db.prepare(`
                SELECT e.*, t.name as turf_name, t.emoji as turf_emoji, ep.role
                FROM event_players ep
                JOIN events e ON ep.event_id = e.id
                LEFT JOIN turfs t ON e.turf_id = t.id
                WHERE ep.player_id = ? AND e.host_id != ?
                ORDER BY e.date DESC
            `).all(playerId, playerId);

            res.json({ hosted, joined });
        } catch (err) {
            console.error('My events error:', err);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    // ── GET /api/events/all — Admin: all events ───
    router.get('/all/list', (req, res) => {
        try {
            const playerId = getPlayerId(req);
            if (!playerId) return res.status(401).json({ error: 'Login required' });
            const player = db.prepare('SELECT is_admin FROM players WHERE id = ?').get(playerId);
            if (!player?.is_admin) return res.status(403).json({ error: 'Admin only' });

            const events = db.prepare(`
                SELECT e.*, p.name as host_name, t.name as turf_name
                FROM events e
                JOIN players p ON e.host_id = p.id
                LEFT JOIN turfs t ON e.turf_id = t.id
                ORDER BY e.created_at DESC
            `).all();
            res.json(events);
        } catch (err) {
            console.error('All events error:', err);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    return router;
};
