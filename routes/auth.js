const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const router = express.Router();

// Simple in-memory token store (maps token -> player_id)
const tokenStore = new Map();

module.exports = function (db) {

    // ── Register ──────────────────────────────
    router.post('/register', (req, res) => {
        try {
            const { name, phone, password, zone, skill_level, position, bio } = req.body;

            if (!name || !phone || !password || !zone || skill_level == null) {
                return res.status(400).json({ error: 'Missing required fields: name, phone, password, zone, skill_level' });
            }
            if (password.length < 4) {
                return res.status(400).json({ error: 'Password must be at least 4 characters' });
            }
            if (!/^\d{10}$/.test(phone)) {
                return res.status(400).json({ error: 'Phone must be 10 digits' });
            }

            const hash = bcrypt.hashSync(password, 10);

            const stmt = db.prepare(`
                INSERT INTO players (name, phone, password_hash, zone, skill_level, position, bio)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `);
            const result = stmt.run(name.trim(), phone.trim(), hash, zone, parseInt(skill_level), position || 'Any', bio || '');

            // Auto-login: generate token
            const token = crypto.randomBytes(32).toString('hex');
            tokenStore.set(token, result.lastInsertRowid);

            const player = db.prepare('SELECT id, name, phone, zone, skill_level, position, bio, is_admin, created_at FROM players WHERE id = ?').get(result.lastInsertRowid);

            res.status(201).json({ message: 'Account created!', token, player });
        } catch (err) {
            if (err.message.includes('UNIQUE constraint failed: players.phone')) {
                return res.status(409).json({ error: 'Phone number already registered. Try logging in.' });
            }
            console.error('Register error:', err);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    // ── Login ─────────────────────────────────
    router.post('/login', (req, res) => {
        try {
            const { phone, password } = req.body;
            if (!phone || !password) {
                return res.status(400).json({ error: 'Phone and password are required' });
            }

            const player = db.prepare('SELECT * FROM players WHERE phone = ?').get(phone.trim());
            if (!player) {
                return res.status(401).json({ error: 'No account found with this phone number' });
            }

            if (!bcrypt.compareSync(password, player.password_hash)) {
                return res.status(401).json({ error: 'Incorrect password' });
            }

            const token = crypto.randomBytes(32).toString('hex');
            tokenStore.set(token, player.id);

            res.json({
                message: 'Login successful!',
                token,
                player: {
                    id: player.id, name: player.name, phone: player.phone,
                    zone: player.zone, skill_level: player.skill_level,
                    position: player.position, bio: player.bio,
                    is_admin: player.is_admin, created_at: player.created_at
                }
            });
        } catch (err) {
            console.error('Login error:', err);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    // ── Get Current User ─────────────────────
    router.get('/me', (req, res) => {
        try {
            const token = req.headers.authorization?.replace('Bearer ', '');
            if (!token || !tokenStore.has(token)) {
                return res.status(401).json({ error: 'Not authenticated' });
            }
            const playerId = tokenStore.get(token);
            const player = db.prepare('SELECT id, name, phone, zone, skill_level, position, bio, is_admin, created_at FROM players WHERE id = ?').get(playerId);
            if (!player) {
                return res.status(404).json({ error: 'Player not found' });
            }
            res.json(player);
        } catch (err) {
            console.error('Me error:', err);
            res.status(500).json({ error: 'Internal server error' });
        }
    });

    // ── Logout ────────────────────────────────
    router.post('/logout', (req, res) => {
        const token = req.headers.authorization?.replace('Bearer ', '');
        if (token) tokenStore.delete(token);
        res.json({ message: 'Logged out' });
    });

    return { router, tokenStore };
};
