const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');

const DB_PATH = path.join(__dirname, 'playmate.db');
const CSV_PATH = path.join(__dirname, 'trending_football_players - Copy.csv');

function importData() {
    const db = new Database(DB_PATH);

    // Clear existing non-admin players
    console.log('🧹 Clearing existing non-admin players...');
    db.pragma('foreign_keys = OFF');
    db.prepare("DELETE FROM players WHERE is_admin = 0").run();
    db.pragma('foreign_keys = ON');

    const csvData = fs.readFileSync(CSV_PATH, 'utf8');
    const lines = csvData.split('\n');
    const headers = lines[0].split(',');

    // Map headers to indices
    const nameIdx = headers.indexOf('Player_name');
    const posIdx = headers.indexOf('Positions');
    const skillIdx = headers.indexOf('Overall');
    const nationIdx = headers.indexOf('National_team');

    const passHash = bcrypt.hashSync('password123', 10);
    const zones = ['Patia', 'Jaydev Vihar', 'Khandagiri', 'Jagamara'];

    const insertStmt = db.prepare(`
        INSERT OR IGNORE INTO players (name, phone, password_hash, zone, skill_level, position, bio)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    let importedCount = 0;

    // Start from line 1 (skip headers), limit to 100 players
    const limit = Math.min(lines.length, 101);

    db.transaction(() => {
        for (let i = 1; i < limit; i++) {
            const line = lines[i];
            if (!line.trim()) continue;

            const cols = line.split(',');
            if (cols.length < headers.length) continue;

            const name = cols[nameIdx];
            const rawSkill = parseInt(cols[skillIdx]);
            // skill_level should be between 1 and 10
            const skillLevel = Math.max(1, Math.min(10, Math.round(rawSkill / 10)));
            const positions = cols[posIdx].replace(/"/g, '').split(' ');
            const position = positions[0] || 'Any';
            const phone = '9' + Math.floor(100000000 + Math.random() * 900000000);
            const zone = zones[Math.floor(Math.random() * zones.length)];
            const bio = `Professional player from ${cols[nationIdx]}. Ratings: ${rawSkill} OVR.`;

            try {
                insertStmt.run(name, phone, passHash, zone, skillLevel, position, bio);
                importedCount++;
            } catch (err) {
                // Skip if error (e.g. unique constraint)
            }
        }
    })();

    console.log(`✅ Successfully imported ${importedCount} players!`);
}

importData();
