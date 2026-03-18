const XLSX = require('xlsx');
const workbook = XLSX.readFile('fifa_players.xlsx');
const sheetName = workbook.SheetNames[0];
const sheet = workbook.Sheets[sheetName];
const data = XLSX.utils.sheet_to_json(sheet, { header: 1 });

console.log('--- HEADERS ---');
console.log(data[0]);
console.log('--- SAMPLE ROW ---');
console.log(data[1]);
