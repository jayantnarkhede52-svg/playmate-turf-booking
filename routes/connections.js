const express = require('express');
const router = express.Router();

module.exports = function (db, tokenStore) {

    function getPlayerId(req) {
        const token = req.headers.authorization?.replace('Bearer ', '');
        if (!token || !tokenStore.has(token)) return null;
        return tokenStore.get(token);
    }

    // ── POST /api/connections — Send connect request ───
    router.post('/', (req, res) => {
        try {
            const fromId = getPlayerId(req);
            if (!fromId) return res.status(401).json({ error: 'Login required' });

            const { to_player_id } = req.body;
            if (!to_player_id) return res.status(400).json({ error: 'to_player_id required' });
            if (to_player_id === fromId) return res.status(400).json({ error: 'Cannot connect to yourself' });

            // Check if connection already exists
            const existing = db.prepare(`
                SELECT * FROM connections 
                WHERE (from_player_id = ? AND to_player_id = ?) OR (from_player_id = ? AND to_player_id = ?)
            `).get(fromId, to_player_id, to_player_id, fromId);

            if (existing) {
                return res.status(409).json({ error: 'Connection already exists', connection: existing });
            }

            const result = db.prepare(
                'INSERT INTO connections (from_player_id, to_player_id) VALUES (?, ?)'
            ).run(fromId, to_player_id);

            const conn = db.prepare('SELECT * FROM connections WHERE id = ?').get(result.lastInsertRowid);
            res.status(201).json({ message: 'Connect request sent!', connection: conn });
        } catch (err) {
            console.error('Connect error:', err);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    // ── GET /api/connections/my — My connections ───
    router.get('/my', (req, res) => {
        try {
            const playerId = getPlayerId(req);
            if (!playerId) return res.status(401).json({ error: 'Login required' });

            // Incoming requests
            const incoming = db.prepare(`
                SELECT c.*, p.name as from_name, p.zone as from_zone, p.skill_level as from_skill, p.position as from_position
                FROM connections c JOIN players p ON c.from_player_id = p.id
                WHERE c.to_player_id = ?
                ORDER BY c.created_at DESC
            `).all(playerId);

            // Outgoing requests
            const outgoing = db.prepare(`
                SELECT c.*, p.name as to_name, p.zone as to_zone, p.skill_level as to_skill, p.position as to_position
                FROM connections c JOIN players p ON c.to_player_id = p.id
                WHERE c.from_player_id = ?
                ORDER BY c.created_at DESC
            `).all(playerId);

            res.json({ incoming, outgoing });
        } catch (err) {
            console.error('My connections error:', err);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    // ── PUT /api/connections/:id/accept ───
    router.put('/:id/accept', (req, res) => {
        try {
            const playerId = getPlayerId(req);
            if (!playerId) return res.status(401).json({ error: 'Login required' });

            const conn = db.prepare('SELECT * FROM connections WHERE id = ?').get(req.params.id);
            if (!conn) return res.status(404).json({ error: 'Connection not found' });
            if (conn.to_player_id !== playerId) return res.status(403).json({ error: 'Not authorized' });

            db.prepare("UPDATE connections SET status = 'accepted' WHERE id = ?").run(req.params.id);
            res.json({ message: 'Connection accepted!' });
        } catch (err) {
            console.error('Accept error:', err);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    // ── PUT /api/connections/:id/reject ───
    router.put('/:id/reject', (req, res) => {
        try {
            const playerId = getPlayerId(req);
            if (!playerId) return res.status(401).json({ error: 'Login required' });

            const conn = db.prepare('SELECT * FROM connections WHERE id = ?').get(req.params.id);
            if (!conn) return res.status(404).json({ error: 'Connection not found' });
            if (conn.to_player_id !== playerId) return res.status(403).json({ error: 'Not authorized' });

            db.prepare("UPDATE connections SET status = 'rejected' WHERE id = ?").run(req.params.id);
            res.json({ message: 'Connection rejected' });
        } catch (err) {
            console.error('Reject error:', err);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    // ── GET /api/connections/all — All connections (admin) ───
    router.get('/all', (req, res) => {
        try {
            const playerId = getPlayerId(req);
            if (!playerId) return res.status(401).json({ error: 'Login required' });
            const player = db.prepare('SELECT is_admin FROM players WHERE id = ?').get(playerId);
            if (!player?.is_admin) return res.status(403).json({ error: 'Admin only' });

            const connections = db.prepare(`
                SELECT c.*, 
                    pf.name as from_name, pf.phone as from_phone,
                    pt.name as to_name, pt.phone as to_phone
                FROM connections c 
                JOIN players p1 ON c.from_player_id = p1.id
                JOIN players pf ON c.from_player_id = pf.id
                JOIN players pt ON c.to_player_id = pt.id
                ORDER BY c.created_at DESC
            `).all();

            res.json(connections);
        } catch (err) {
            console.error('All connections error:', err);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    return router;
};
