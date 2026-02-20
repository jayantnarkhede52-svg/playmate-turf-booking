const express = require('express');
const router = express.Router();

module.exports = function (db, tokenStore) {

    function getPlayerId(req) {
        const token = req.headers.authorization?.replace('Bearer ', '');
        if (!token || !tokenStore.has(token)) return null;
        return tokenStore.get(token);
    }

    // ── GET /api/chat/conversations — List all conversations ───
    router.get('/conversations', (req, res) => {
        try {
            const playerId = getPlayerId(req);
            if (!playerId) return res.status(401).json({ error: 'Login required' });

            // Get all unique conversation partners with last message
            const conversations = db.prepare(`
                SELECT 
                    CASE WHEN m.from_id = ? THEN m.to_id ELSE m.from_id END as partner_id,
                    p.name as partner_name,
                    p.zone as partner_zone,
                    p.position as partner_position,
                    MAX(m.created_at) as last_message_at,
                    (SELECT content FROM messages m2 
                     WHERE ((m2.from_id = ? AND m2.to_id = p.id) OR (m2.from_id = p.id AND m2.to_id = ?))
                     ORDER BY m2.created_at DESC LIMIT 1) as last_message,
                    (SELECT COUNT(*) FROM messages m3 
                     WHERE m3.from_id = p.id AND m3.to_id = ? AND m3.is_read = 0) as unread_count
                FROM messages m
                JOIN players p ON p.id = CASE WHEN m.from_id = ? THEN m.to_id ELSE m.from_id END
                WHERE m.from_id = ? OR m.to_id = ?
                GROUP BY partner_id
                ORDER BY last_message_at DESC
            `).all(playerId, playerId, playerId, playerId, playerId, playerId, playerId);

            res.json(conversations);
        } catch (err) {
            console.error('Conversations error:', err);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    // ── GET /api/chat/messages/:playerId — Messages with a player ───
    router.get('/messages/:playerId', (req, res) => {
        try {
            const playerId = getPlayerId(req);
            if (!playerId) return res.status(401).json({ error: 'Login required' });

            const partnerId = parseInt(req.params.playerId);
            const messages = db.prepare(`
                SELECT m.*, 
                    pf.name as from_name
                FROM messages m
                JOIN players pf ON m.from_id = pf.id
                WHERE (m.from_id = ? AND m.to_id = ?) OR (m.from_id = ? AND m.to_id = ?)
                ORDER BY m.created_at ASC
            `).all(playerId, partnerId, partnerId, playerId);

            // Mark incoming as read
            db.prepare('UPDATE messages SET is_read = 1 WHERE from_id = ? AND to_id = ? AND is_read = 0')
                .run(partnerId, playerId);

            const partner = db.prepare('SELECT id, name, zone, position, skill_level FROM players WHERE id = ?').get(partnerId);

            res.json({ partner, messages });
        } catch (err) {
            console.error('Messages error:', err);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    // ── POST /api/chat/send — Send a message ───
    router.post('/send', (req, res) => {
        try {
            const fromId = getPlayerId(req);
            if (!fromId) return res.status(401).json({ error: 'Login required' });

            const { to_id, content } = req.body;
            if (!to_id || !content?.trim()) return res.status(400).json({ error: 'to_id and content required' });
            if (to_id === fromId) return res.status(400).json({ error: 'Cannot message yourself' });

            // Verify connection
            const connection = db.prepare(`
                SELECT * FROM connections 
                WHERE ((from_player_id = ? AND to_player_id = ?) OR (from_player_id = ? AND to_player_id = ?))
                AND status = 'accepted'
            `).get(fromId, to_id, to_id, fromId);

            if (!connection) {
                return res.status(403).json({ error: 'You can only message connected players' });
            }

            const result = db.prepare('INSERT INTO messages (from_id, to_id, content) VALUES (?, ?, ?)')
                .run(fromId, parseInt(to_id), content.trim());

            const msg = db.prepare('SELECT m.*, p.name as from_name FROM messages m JOIN players p ON m.from_id = p.id WHERE m.id = ?')
                .get(result.lastInsertRowid);

            res.status(201).json(msg);
        } catch (err) {
            console.error('Send message error:', err);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    // ── PUT /api/chat/read/:playerId — Mark as read ───
    router.put('/read/:playerId', (req, res) => {
        try {
            const playerId = getPlayerId(req);
            if (!playerId) return res.status(401).json({ error: 'Login required' });

            db.prepare('UPDATE messages SET is_read = 1 WHERE from_id = ? AND to_id = ? AND is_read = 0')
                .run(parseInt(req.params.playerId), playerId);

            res.json({ message: 'Marked as read' });
        } catch (err) {
            console.error('Mark read error:', err);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    // ── GET /api/chat/unread — Unread count ───
    router.get('/unread', (req, res) => {
        try {
            const playerId = getPlayerId(req);
            if (!playerId) return res.status(401).json({ error: 'Login required' });

            const result = db.prepare('SELECT COUNT(*) as count FROM messages WHERE to_id = ? AND is_read = 0').get(playerId);
            res.json({ unread: result.count });
        } catch (err) {
            console.error('Unread error:', err);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    return router;
};
