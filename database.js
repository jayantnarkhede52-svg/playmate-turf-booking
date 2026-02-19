const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, 'playmate.db');

function initDatabase() {
    const db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');

    // Players table (with password)
    db.exec(`
        CREATE TABLE IF NOT EXISTS players (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            phone TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            zone TEXT NOT NULL,
            skill_level INTEGER NOT NULL CHECK(skill_level BETWEEN 1 AND 10),
            position TEXT DEFAULT 'Any',
            bio TEXT DEFAULT '',
            avatar_url TEXT DEFAULT '',
            is_admin INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // Turfs table
    db.exec(`
        CREATE TABLE IF NOT EXISTS turfs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            location TEXT NOT NULL,
            price_per_hour INTEGER NOT NULL,
            formats TEXT DEFAULT '5v5',
            emoji TEXT DEFAULT '⚽',
            description TEXT DEFAULT ''
        )
    `);

    // Bookings table
    db.exec(`
        CREATE TABLE IF NOT EXISTS bookings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            player_id INTEGER NOT NULL REFERENCES players(id),
            turf_id INTEGER NOT NULL REFERENCES turfs(id),
            date TEXT NOT NULL,
            slot TEXT NOT NULL,
            status TEXT DEFAULT 'confirmed',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(turf_id, date, slot)
        )
    `);

    // Connections table
    db.exec(`
        CREATE TABLE IF NOT EXISTS connections (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            from_player_id INTEGER NOT NULL REFERENCES players(id),
            to_player_id INTEGER NOT NULL REFERENCES players(id),
            status TEXT DEFAULT 'pending',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // Events table
    db.exec(`
        CREATE TABLE IF NOT EXISTS events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            host_id INTEGER NOT NULL REFERENCES players(id),
            turf_id INTEGER REFERENCES turfs(id),
            title TEXT NOT NULL,
            format TEXT DEFAULT '5v5',
            date TEXT NOT NULL,
            time TEXT NOT NULL,
            total_slots INTEGER NOT NULL,
            filled_slots INTEGER DEFAULT 1,
            status TEXT DEFAULT 'open',
            description TEXT DEFAULT '',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // Event players join table
    db.exec(`
        CREATE TABLE IF NOT EXISTS event_players (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            event_id INTEGER NOT NULL REFERENCES events(id),
            player_id INTEGER NOT NULL REFERENCES players(id),
            role TEXT DEFAULT 'player',
            joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(event_id, player_id)
        )
    `);

    // Messages table
    db.exec(`
        CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            from_id INTEGER NOT NULL REFERENCES players(id),
            to_id INTEGER NOT NULL REFERENCES players(id),
            content TEXT NOT NULL,
            is_read INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // Seed default turfs if empty
    const turfCount = db.prepare('SELECT COUNT(*) as c FROM turfs').get().c;
    if (turfCount === 0) {
        const insertTurf = db.prepare(`
            INSERT INTO turfs (name, location, price_per_hour, formats, emoji, description)
            VALUES (?, ?, ?, ?, ?, ?)
        `);
        insertTurf.run('Kick Off Turf', 'Patia, near KIIT Square', 1200, '5v5, 7v7', '⚡', '5v5 and 7v7 available. Floodlights included.');
        insertTurf.run('The Arena', 'Jaydev Vihar', 1000, '5v5', '🥅', 'Best for 5v5. Parking available.');
        insertTurf.run('Soccer City', 'Khandagiri / Jagamara', 800, '6v6', '⚽', 'Budget friendly. 6v6 size.');
        console.log('🏟️  Seeded 3 default turfs');
    }

    // Seed admin account if none exists
    const adminCount = db.prepare('SELECT COUNT(*) as c FROM players WHERE is_admin = 1').get().c;
    if (adminCount === 0) {
        const bcrypt = require('bcryptjs');
        const hash = bcrypt.hashSync('admin123', 10);
        db.prepare(`
            INSERT INTO players (name, phone, password_hash, zone, skill_level, position, is_admin)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run('Admin', '0000000000', hash, 'Patia', 10, 'Any', 1);
        console.log('👤 Seeded admin account (phone: 0000000000 / pass: admin123)');
    }

    console.log('✅ Database initialized at', DB_PATH);
    return db;
}

module.exports = { initDatabase };
