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
    
    // Very simple CSV parser for quoted fields
    function parseCSVLine(line) {
        const result = [];
        let current = '';
        let inQuotes = false;
        for (let i = 0; i < line.length; i++) {
            const char = line[i];
            if (char === '"') {
                inQuotes = !inQuotes;
            } else if (char === ',' && !inQuotes) {
                result.push(current.trim());
                current = '';
            } else {
                current += char;
            }
        }
        result.push(current.trim());
        return result;
    }

    const headers = parseCSVLine(lines[0]);
    console.log('Detected Headers:', headers);

    const nameIdx = headers.indexOf('Player_name');
    const posIdx = headers.indexOf('Positions');
    const skillIdx = headers.indexOf('Overall');
    const nationIdx = headers.indexOf('National_team');

    const passHash = bcrypt.hashSync('password123', 10);
    const zones = ['Patia', 'Jaydev Vihar', 'Khandagiri', 'Jagamara', 'KIIT Campus', 'Infocity', 'Chandrasekharpur', 'Saheed Nagar'];
    const positionsList = ['Forward', 'Midfielder', 'Defender', 'Goalkeeper'];

    const insertStmt = db.prepare(`
        INSERT OR IGNORE INTO players (name, phone, password_hash, zone, skill_level, position, bio)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    let importedCount = 0;
    // We want at least 400 players. Let's aim for 450 if available.
    const limit = Math.min(lines.length, 500);

    db.transaction(() => {
        for (let i = 1; i < limit; i++) {
            const line = lines[i];
            if (!line.trim()) continue;

            const cols = parseCSVLine(line);
            if (cols.length < headers.length) continue;

            const name = cols[nameIdx] || 'Unknown Player';
            const rawSkill = parseInt(cols[skillIdx]) || 50;
            
            // skill_level: Scale 0-100 to 1-10
            let skillLevel = Math.max(1, Math.min(10, Math.round(rawSkill / 10)));
            // Add some randomness to skill (+/- 1)
            skillLevel = Math.max(1, Math.min(10, skillLevel + (Math.random() > 0.5 ? 1 : -1)));

            // Position mapping
            let position = 'Any';
            const rawPos = (cols[posIdx] || '').replace(/[\[\]']/g, '').split(',')[0].trim();
            if (rawPos.includes('ST') || rawPos.includes('RW') || rawPos.includes('LW') || rawPos.includes('CF')) position = 'Forward';
            else if (rawPos.includes('CM') || rawPos.includes('CDM') || rawPos.includes('CAM') || rawPos.includes('LM') || rawPos.includes('RM')) position = 'Midfielder';
            else if (rawPos.includes('CB') || rawPos.includes('LB') || rawPos.includes('RB') || rawPos.includes('LWB') || rawPos.includes('RWB')) position = 'Defender';
            else if (rawPos.includes('GK')) position = 'Goalkeeper';
            else position = positionsList[Math.floor(Math.random() * positionsList.length)];

            // Phone: Unique 10 digits
            const phone = '9' + (100000000 + importedCount).toString().padStart(9, '0');
            const zone = zones[Math.floor(Math.random() * zones.length)];
            const nation = cols[nationIdx] || 'International';
            const bio = `Professional player from ${nation}. Rated ${rawSkill} OVR. Specialized in ${position} play. Seeking local teammates in ${zone}.`;

            try {
                insertStmt.run(name, phone, passHash, zone, skillLevel, position, bio);
                importedCount++;
            } catch (err) {
                console.error(`Error inserting ${name}:`, err.message);
            }
        }
    })();

    console.log(`\n✅ SUCCESSFULLY IMPORTED ${importedCount} PLAYERS!`);
    console.log(`📍 Database updated: ${DB_PATH}`);
}

importData();
