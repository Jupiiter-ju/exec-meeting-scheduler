// สร้างค่า NAME_TO_DISCORD (JSON ชื่อเล่น → Discord ID) จาก map ใน node "Resolve Employee"
// ของ export n8n หลัก (Exec Meeting Scheduler V.1.json) ซึ่งเป็นต้นฉบับที่ถูกต้องที่สุด
//
// วิธีใช้ (รันจากโฟลเดอร์โปรเจค):
//   node apps-script/make_name_map.js
// ผลลัพธ์:
//   - เขียนไฟล์ apps-script/name_map.local.json (ถูก gitignore — ไม่เข้า git)
//   - คัดลอกเนื้อหาไฟล์ขึ้นคลิปบอร์ดให้ด้วย (Windows) → ไปวางในช่อง Value ของ Script Property NAME_TO_DISCORD
//   - พิมพ์เฉพาะ "รายชื่อ" ออกหน้าจอ (ไม่พิมพ์ ID) เพื่อให้เช็คได้ว่าครบคน

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const exportPath = path.join(root, 'Exec Meeting Scheduler V.1.json');
const outPath = path.join(__dirname, 'name_map.local.json');

if (!fs.existsSync(exportPath)) {
  console.error('ไม่พบไฟล์ export: ' + exportPath);
  console.error('ให้ export workflow หลักจาก n8n มาวางไว้ที่โฟลเดอร์โปรเจคชื่อ "Exec Meeting Scheduler V.1.json" ก่อน');
  process.exit(1);
}

const wf = JSON.parse(fs.readFileSync(exportPath, 'utf8'));
const node = (wf.nodes || []).find(n => n.name === 'Resolve Employee');
if (!node || !node.parameters || !node.parameters.jsCode) {
  console.error('ไม่พบ node "Resolve Employee" ใน export');
  process.exit(1);
}
const m = node.parameters.jsCode.match(/const EMPLOYEE_MAP = (\{[\s\S]*?\n\});/);
if (!m) {
  console.error('อ่าน EMPLOYEE_MAP จาก Resolve Employee ไม่ได้ — รูปแบบโค้ดเปลี่ยนไป');
  process.exit(1);
}
const EMPLOYEE_MAP = new Function('return ' + m[1])();

const map = {};
for (const [discordId, emp] of Object.entries(EMPLOYEE_MAP)) {
  if (emp && emp.name) map[String(emp.name).normalize('NFC')] = String(discordId);
}

const json = JSON.stringify(map);
fs.writeFileSync(outPath, json, 'utf8');

let clip = 'ไม่ได้คัดลอกขึ้นคลิปบอร์ด (ไม่ใช่ Windows) — เปิดไฟล์แล้วคัดลอกเอง';
if (process.platform === 'win32') {
  try {
    // อ่านไฟล์เป็น UTF-8 ใน PowerShell โดยตรง (ไม่ผ่าน pipe) กันภาษาไทยเพี้ยน
    execFileSync('powershell', ['-NoProfile', '-Command',
      "Set-Clipboard -Value (Get-Content -Raw -Encoding UTF8 -LiteralPath '" + outPath.replace(/'/g, "''") + "')"]);
    clip = 'คัดลอกขึ้นคลิปบอร์ดแล้ว → ไปวาง (Ctrl+V) ในช่อง Value ของ Script Property NAME_TO_DISCORD ได้เลย';
  } catch (e) {
    clip = 'คัดลอกขึ้นคลิปบอร์ดไม่สำเร็จ (' + e.message + ') — เปิดไฟล์ name_map.local.json ด้วย VS Code แล้วคัดลอกเอง (อย่าเปิดด้วย Notepad ภาษาไทยจะเพี้ยน)';
  }
}

console.log('สร้าง map สำเร็จ ' + Object.keys(map).length + ' ชื่อ: ' + Object.keys(map).join(', '));
console.log('เต้ → ' + (map['เต้'] === '286166512442540034' ? 'ID ถูกต้อง (ตรงกับที่ยืนยันไว้)' : '⚠️ ID ไม่ตรงกับที่ยืนยันไว้ 2026-10-22 ตรวจสอบ Resolve Employee'));
console.log('ไฟล์: ' + outPath);
console.log(clip);
