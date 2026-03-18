const express = require('express');
const router = express.Router();
const ML = require('../ml-utils');

module.exports = function (db, tokenStore) {

    function getPlayerId(req) {
        const token = req.headers.authorization?.replace('Bearer ', '');
        if (!token || !tokenStore.has(token)) return null;
        return tokenStore.get(token);
    }

    // ── GET /api/players — List all players ───
    router.get('/', (req, res) => {
        try {
            let query = 'SELECT id, name, phone, zone, skill_level, position, bio, created_at FROM players WHERE is_admin = 0';
            const params = [];

            if (req.query.zone) { query += ' AND zone = ?'; params.push(req.query.zone); }
            if (req.query.skill) { query += ' AND skill_level = ?'; params.push(parseInt(req.query.skill)); }
            query += ' ORDER BY created_at DESC';

            const players = db.prepare(query).all(...params);
            res.json({ count: players.length, players });
        } catch (err) {
            console.error('List players error:', err);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    // ── GET /api/players/:id — Get single player ───
    router.get('/:id', (req, res) => {
        try {
            const player = db.prepare('SELECT id, name, phone, zone, skill_level, position, bio, created_at FROM players WHERE id = ?').get(req.params.id);
            if (!player) return res.status(404).json({ error: 'Player not found' });
            res.json(player);
        } catch (err) {
            console.error('Get player error:', err);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    // ── PUT /api/players/:id — Update player profile ───
    router.put('/:id', (req, res) => {
        try {
            const playerId = getPlayerId(req);
            if (!playerId) return res.status(401).json({ error: 'Login required' });

            const targetId = parseInt(req.params.id);
            const player = db.prepare('SELECT is_admin FROM players WHERE id = ?').get(playerId);
            if (targetId !== playerId && !player?.is_admin) {
                return res.status(403).json({ error: 'Not authorized' });
            }

            const { name, zone, skill_level, position, bio } = req.body;
            db.prepare(`
                UPDATE players SET
                    name = COALESCE(?, name),
                    zone = COALESCE(?, zone),
                    skill_level = COALESCE(?, skill_level),
                    position = COALESCE(?, position),
                    bio = COALESCE(?, bio)
                WHERE id = ?
            `).run(name || null, zone || null, skill_level != null ? parseInt(skill_level) : null, position || null, bio !== undefined ? bio : null, targetId);

            const updated = db.prepare('SELECT id, name, phone, zone, skill_level, position, bio, created_at FROM players WHERE id = ?').get(targetId);
            res.json({ message: 'Profile updated!', player: updated });
        } catch (err) {
            console.error('Update player error:', err);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    // ── DELETE /api/players/:id — Delete player ───
    router.delete('/:id', (req, res) => {
        try {
            const playerId = getPlayerId(req);
            if (!playerId) return res.status(401).json({ error: 'Login required' });
            const player = db.prepare('SELECT is_admin FROM players WHERE id = ?').get(playerId);
            if (!player?.is_admin) return res.status(403).json({ error: 'Admin only' });

            const result = db.prepare('DELETE FROM players WHERE id = ?').run(req.params.id);
            if (result.changes === 0) return res.status(404).json({ error: 'Player not found' });
            res.json({ message: 'Player deleted' });
        } catch (err) {
            console.error('Delete player error:', err);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    // ── GET /api/players/match/:id — AI Match ───
    router.get('/match/:id', (req, res) => {
        try {
            const player = db.prepare('SELECT * FROM players WHERE id = ?').get(req.params.id);
            if (!player) return res.status(404).json({ error: 'Player not found' });

            const playerId = getPlayerId(req);
            let connectedIds = [];
            if (playerId) {
                connectedIds = db.prepare(`
                    SELECT CASE WHEN from_player_id = ? THEN to_player_id ELSE from_player_id END as other_id
                    FROM connections WHERE (from_player_id = ? OR to_player_id = ?) AND status != 'rejected'
                `).all(playerId, playerId, playerId).map(c => c.other_id);
            }

            // Get all potential candidates
            const candidates = db.prepare('SELECT id, name, zone, skill_level, position, bio FROM players WHERE id != ? AND is_admin = 0').all(player.id);

            // ML Matching Logic
            const playerVector = [
                ML.normalize(player.skill_level, 1, 10),
                ML.encodePosition(player.position)
            ];

            const results = candidates.map(c => {
                const candidateVector = [
                    ML.normalize(c.skill_level, 1, 10),
                    ML.encodePosition(c.position)
                ];

                // Calculate Similarity (Weights: Skill=0.7, Position=0.3)
                const similarity = ML.cosineSimilarity(playerVector, candidateVector, [0.7, 0.3]);
                const zoneBonus = ML.zoneMatchScore(player.zone, c.zone);

                // Combine similarity with zone match (60% similarity, 40% zone)
                const finalScore = Math.round(((similarity * 0.6) + (zoneBonus * 0.4)) * 100);

                // Generate Insights
                const insights = [];
                if (c.zone === player.zone) insights.push("Same Zone");
                if (Math.abs(c.skill_level - player.skill_level) <= 1) insights.push("Similar Skill");
                if (c.position === player.position) insights.push("Same Position");

                return {
                    id: c.id, name: c.name, zone: c.zone,
                    skill_level: c.skill_level, position: c.position, bio: c.bio,
                    match_percent: Math.min(100, finalScore),
                    insights,
                    connection_status: connectedIds.includes(c.id) ? 'connected' : null
                };
            });

            results.sort((a, b) => b.match_percent - a.match_percent);
            res.json({ player: { id: player.id, name: player.name, zone: player.zone }, matches: results.slice(0, 20) });
        } catch (err) {
            console.error('Match error:', err);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    // ── Admin: GET /api/players/admin/all — All players with stats ───
    router.get('/admin/all', (req, res) => {
        try {
            const playerId = getPlayerId(req);
            if (!playerId) return res.status(401).json({ error: 'Login required' });
            const player = db.prepare('SELECT is_admin FROM players WHERE id = ?').get(playerId);
            if (!player?.is_admin) return res.status(403).json({ error: 'Admin only' });

            const players = db.prepare('SELECT id, name, phone, zone, skill_level, position, bio, is_admin, created_at FROM players ORDER BY created_at DESC').all();
            res.json(players);
        } catch (err) {
            console.error('Admin players error:', err);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    return router;
};
