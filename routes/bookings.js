const express = require('express');
const router = express.Router();

module.exports = function (db, tokenStore) {

    // Auth middleware helper
    function getPlayerId(req) {
        const token = req.headers.authorization?.replace('Bearer ', '');
        if (!token || !tokenStore.has(token)) return null;
        return tokenStore.get(token);
    }

    // ── GET /api/turfs — List all turfs ───────
    router.get('/turfs', (req, res) => {
        try {
            const turfs = db.prepare('SELECT * FROM turfs ORDER BY id').all();
            res.json(turfs);
        } catch (err) {
            console.error('List turfs error:', err);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    // ── GET /api/turfs/:id/slots?date= — Get slots for a turf ───
    router.get('/turfs/:id/slots', (req, res) => {
        try {
            const turf = db.prepare('SELECT * FROM turfs WHERE id = ?').get(req.params.id);
            if (!turf) return res.status(404).json({ error: 'Turf not found' });

            const date = req.query.date;
            if (!date) return res.status(400).json({ error: 'date query param required' });

            // All possible slots
            const allSlots = ['4:00 PM', '5:00 PM', '6:00 PM', '7:00 PM', '8:00 PM', '9:00 PM'];

            // Get booked slots for this turf+date
            const bookedSlots = db.prepare(
                'SELECT slot FROM bookings WHERE turf_id = ? AND date = ? AND status = ?'
            ).all(req.params.id, date, 'confirmed').map(b => b.slot);

            const slots = allSlots.map(s => ({
                time: s,
                available: !bookedSlots.includes(s)
            }));

            res.json({ turf, date, slots });
        } catch (err) {
            console.error('Slots error:', err);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    // ── POST /api/bookings — Create booking ───
    router.post('/bookings', (req, res) => {
        try {
            const playerId = getPlayerId(req);
            if (!playerId) return res.status(401).json({ error: 'Login required to book' });

            const { turf_id, date, slot } = req.body;
            if (!turf_id || !date || !slot) {
                return res.status(400).json({ error: 'turf_id, date, and slot are required' });
            }

            // Check if slot is available
            const existing = db.prepare(
                'SELECT id FROM bookings WHERE turf_id = ? AND date = ? AND slot = ? AND status = ?'
            ).get(turf_id, date, slot, 'confirmed');

            if (existing) {
                return res.status(409).json({ error: 'This slot is already booked' });
            }

            const result = db.prepare(
                'INSERT INTO bookings (player_id, turf_id, date, slot) VALUES (?, ?, ?, ?)'
            ).run(playerId, turf_id, date, slot);

            const booking = db.prepare(`
                SELECT b.*, t.name as turf_name, t.location as turf_location
                FROM bookings b JOIN turfs t ON b.turf_id = t.id
                WHERE b.id = ?
            `).get(result.lastInsertRowid);

            res.status(201).json({ message: 'Booking confirmed!', booking });
        } catch (err) {
            if (err.message.includes('UNIQUE constraint')) {
                return res.status(409).json({ error: 'Slot already booked' });
            }
            console.error('Booking error:', err);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    // ── GET /api/bookings/my — My bookings ────
    router.get('/bookings/my', (req, res) => {
        try {
            const playerId = getPlayerId(req);
            if (!playerId) return res.status(401).json({ error: 'Login required' });

            const bookings = db.prepare(`
                SELECT b.*, t.name as turf_name, t.location as turf_location, t.emoji as turf_emoji
                FROM bookings b JOIN turfs t ON b.turf_id = t.id
                WHERE b.player_id = ?
                ORDER BY b.date DESC, b.slot DESC
            `).all(playerId);

            res.json(bookings);
        } catch (err) {
            console.error('My bookings error:', err);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    // ── GET /api/bookings/all — All bookings (admin) ────
    router.get('/bookings/all', (req, res) => {
        try {
            const playerId = getPlayerId(req);
            if (!playerId) return res.status(401).json({ error: 'Login required' });
            const player = db.prepare('SELECT is_admin FROM players WHERE id = ?').get(playerId);
            if (!player?.is_admin) return res.status(403).json({ error: 'Admin only' });

            const bookings = db.prepare(`
                SELECT b.*, t.name as turf_name, p.name as player_name, p.phone as player_phone
                FROM bookings b 
                JOIN turfs t ON b.turf_id = t.id
                JOIN players p ON b.player_id = p.id
                ORDER BY b.created_at DESC
            `).all();

            res.json(bookings);
        } catch (err) {
            console.error('All bookings error:', err);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    // ── DELETE /api/bookings/:id — Cancel booking ────
    router.delete('/bookings/:id', (req, res) => {
        try {
            const playerId = getPlayerId(req);
            if (!playerId) return res.status(401).json({ error: 'Login required' });

            const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(req.params.id);
            if (!booking) return res.status(404).json({ error: 'Booking not found' });

            const player = db.prepare('SELECT is_admin FROM players WHERE id = ?').get(playerId);
            if (booking.player_id !== playerId && !player?.is_admin) {
                return res.status(403).json({ error: 'Not authorized' });
            }

            db.prepare("UPDATE bookings SET status = 'cancelled' WHERE id = ?").run(req.params.id);
            res.json({ message: 'Booking cancelled' });
        } catch (err) {
            console.error('Cancel booking error:', err);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    return router;
};
