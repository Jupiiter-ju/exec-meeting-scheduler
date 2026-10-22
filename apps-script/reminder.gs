/**
 * แจ้งเตือนนัดหมายผู้บริหารล่วงหน้า ~1 ชั่วโมง ทาง Discord DM
 * (Google Apps Script — แทนที่ n8n workflow "แจ้งเตือนนัดหมายล่วงหน้า 1 ชม. (Meeting Reminder)")
 *
 * วิธีทำงาน (ตรงกับ workflow เดิม):
 *  - trigger รันทุก 10 นาที (ติดตั้งด้วยฟังก์ชัน installTrigger)
 *  - ข้ามวันเสาร์-อาทิตย์ (เวลาไทย)
 *  - อ่าน event จากปฏิทิน 3 ใบ (exe / combo / agenix) ที่จะเริ่มในอีก ~1 ชั่วโมง
 *  - ยุบนัด 2 ผู้บริหาร (2 event ชื่อเดียวกัน เวลาเดียวกัน) ให้เตือนครั้งเดียว
 *  - อ่านบรรทัด "ผู้ขอนัด:" / "หัวข้อ:" / "ผู้บริหารที่เข้าร่วม:" จาก description ของ event
 *  - หา Discord ID จากชื่อผู้ขอนัด แล้วส่ง DM ผ่าน Discord REST API
 *  - กันเตือนซ้ำด้วย PropertiesService (จำว่านัดไหนเตือนไปแล้ว) แม้ trigger จะรันเหลื่อมเวลา
 *
 * ค่าลับทั้งหมดอยู่ใน Script Properties (Project Settings → Script Properties) ไม่อยู่ในโค้ด:
 *  - DISCORD_BOT_TOKEN   token ของบอท (น้องจู / Agent-Ju) — บังคับ
 *  - NAME_TO_DISCORD     JSON {"ชื่อเล่น":"DiscordID", ...} — บังคับ
 *  - EXCLUDE_NAMES       (ไม่บังคับ) ชื่อที่ไม่ต้องเตือน คั่นด้วยจุลภาค เช่น "พี่กฤช,พี่เบียร์"
 *  - TEST_DISCORD_ID     (ไม่บังคับ) Discord ID ของตัวเอง ใช้กับฟังก์ชัน testDiscordDm
 *
 * ฟังก์ชันที่กดรันเองได้จาก editor:
 *  - installTrigger()   ติดตั้ง trigger ทุก 10 นาที (รันครั้งเดียว)
 *  - removeTriggers()   ถอด trigger ทั้งหมดของสคริปต์นี้
 *  - showConfig()       เช็คว่าตั้งค่า Script Properties ครบไหม (ไม่โชว์ token)
 *  - testDiscordDm()    ส่ง DM ทดสอบหา TEST_DISCORD_ID
 *  - dryRun()           จำลองรอบปัจจุบัน: โชว์ว่าจะส่งอะไรให้ใคร แต่ไม่ส่งจริง ไม่บันทึกว่าเตือนแล้ว
 *  - previewNext24h()   ไล่ดูนัดใน 24 ชม.ข้างหน้าว่าแต่ละนัดจะเตือนได้ไหม (เช็คการอ่านชื่อ/ID)
 *  - resetDedupe()      ล้างความจำ "เตือนไปแล้ว" (ใช้ตอนทดสอบซ้ำนัดเดิม)
 */

// ==== ปฏิทิน 3 ใบ (ค่าเดียวกับ Code node ใน n8n) ====
var CALENDARS = {
  exe: 'iu6g1bhd6usd3n8b0o0vlcm1q4@group.calendar.google.com',
  combo: 'db69a654618b65881e7a9212c8aae6722054d04383b46421b169dbdb2f24df61@group.calendar.google.com',
  agenix: 'ba092c3a4f539529417c642d71fa0f42b76c0c60013f86cda3a6c4833c374933@group.calendar.google.com'
};

var TZ = 'Asia/Bangkok';
var INTERVAL_MIN = 10;          // ความถี่ trigger (นาที) — ต้องตรงกับ installTrigger
var LEAD_MIN = 60;              // แจ้งเตือนล่วงหน้ากี่นาที
var CATCHUP_MAX_MIN = 30;       // ถ้า trigger หายไปหลายรอบ ให้ย้อนเก็บตกได้ไม่เกินกี่นาที
var DEDUPE_TTL_MS = 36 * 60 * 60 * 1000;   // จำว่าเตือนแล้วไว้นานแค่ไหน (36 ชม. พอแล้ว)

var PROP_REMINDED = 'REMINDED_KEYS';        // JSON { "<key>": epochMs }
var PROP_LAST_WINDOW_END = 'LAST_WINDOW_END';
var PROP_DM_CHANNEL_PREFIX = 'DM_CHANNEL_'; // cache channel id ของ DM แต่ละคน

var THAI_DOW = ['วันอาทิตย์', 'วันจันทร์', 'วันอังคาร', 'วันพุธ', 'วันพฤหัสบดี', 'วันศุกร์', 'วันเสาร์'];
var THAI_MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];

// =====================================================================
//  ฟังก์ชันหลักที่ trigger เรียก
// =====================================================================

function sendReminders() {
  runReminderCycle_(false);
}

function dryRun() {
  runReminderCycle_(true);
}

function runReminderCycle_(dryRun) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30 * 1000)) {
    Logger.log('รอบก่อนหน้ายังทำงานไม่เสร็จ ข้ามรอบนี้');
    return;
  }
  try {
    var now = new Date();
    if (isWeekendBkk_(now)) {
      if (!dryRun) {
        Logger.log('วันเสาร์-อาทิตย์ ไม่มีนัด ข้าม');
        return;
      }
      Logger.log('[dryRun] วันนี้เป็นวันเสาร์-อาทิตย์ — รอบจริงจะข้าม แต่ dryRun ค้นหาต่อให้ดู');
    }

    var win = computeWindow_(now);
    Logger.log('ค้นหานัดที่เริ่มระหว่าง %s ถึง %s (เวลาไทย)', fmtLog_(win.start), fmtLog_(win.end));

    var reminders = collectReminders_(win.start, win.end);
    Logger.log('พบนัดที่เข้าเงื่อนไข %s รายการ', reminders.length);

    var props = PropertiesService.getScriptProperties();
    var reminded = loadReminded_(props);
    var sent = 0;

    reminders.forEach(function (r) {
      if (reminded[r.key]) {
        Logger.log('เตือนไปแล้ว ข้าม: %s', r.key);
        return;
      }
      if (dryRun) {
        Logger.log('[dryRun] จะส่งหา %s (%s):\n%s', r.callerName, r.discordId, r.message);
        return;
      }
      try {
        sendDiscordDm_(r.discordId, r.message);
        reminded[r.key] = Date.now();
        sent++;
        Logger.log('ส่งแล้ว: %s → %s', r.key, r.callerName);
      } catch (e) {
        // ส่งไม่ได้ (เช่น ผู้ใช้ปิด DM) — บันทึก error แล้วทำรายการถัดไปต่อ ไม่ให้ล้มทั้งรอบ
        Logger.log('ส่งไม่สำเร็จ %s → %s: %s', r.key, r.callerName, e && e.message ? e.message : e);
      }
    });

    if (!dryRun) {
      saveReminded_(props, reminded);
      props.setProperty(PROP_LAST_WINDOW_END, String(win.end.getTime()));
      Logger.log('สรุป: ส่งสำเร็จ %s รายการ', sent);
    }
  } finally {
    lock.releaseLock();
  }
}

// =====================================================================
//  ช่วงเวลาค้นหา
// =====================================================================

/**
 * หน้าต่างค้นหา = [now + LEAD - INTERVAL, now + LEAD + INTERVAL) โดยประมาณ (เช่น 50–70 นาทีข้างหน้า)
 * กว้างกว่า 1 รอบ trigger เพื่อให้แต่ละนัดโผล่ใน 2 รอบติดกัน — ถ้า trigger รอบหนึ่งหายหรือมาช้า
 * ก็ยังจับได้ในรอบถัดไป; การกันซ้ำทำด้วย REMINDED_KEYS ไม่ใช่การแบ่งช่อง 10 นาทีแบบเดิม
 * และถ้ารอบก่อนจบที่ไหน จะเริ่มต่อจากตรงนั้น (ย้อนได้ไม่เกิน CATCHUP_MAX_MIN นาที)
 */
function computeWindow_(now) {
  var lead = LEAD_MIN * 60 * 1000;
  var interval = INTERVAL_MIN * 60 * 1000;
  var start = new Date(now.getTime() + lead - interval);
  var end = new Date(now.getTime() + lead + interval);

  var lastEnd = Number(PropertiesService.getScriptProperties().getProperty(PROP_LAST_WINDOW_END) || 0);
  var earliest = now.getTime() + lead - CATCHUP_MAX_MIN * 60 * 1000;
  if (lastEnd && lastEnd < start.getTime() && lastEnd >= earliest) {
    start = new Date(lastEnd);  // เก็บตกช่วงที่หายไประหว่างรอบ
  }
  return { start: start, end: end };
}

function isWeekendBkk_(d) {
  var dow = Number(Utilities.formatDate(d, TZ, 'u')); // 1=จันทร์ … 7=อาทิตย์
  return dow === 6 || dow === 7;
}

// =====================================================================
//  อ่าน event จากปฏิทินแล้วแปลงเป็นรายการแจ้งเตือน
// =====================================================================

function collectReminders_(timeMin, timeMax) {
  var nameMap = loadNameMap_();
  var exclude = loadExcludeSet_();
  var seen = {};
  var out = [];

  Object.keys(CALENDARS).forEach(function (calKey) {
    var calendarId = CALENDARS[calKey];
    var events;
    try {
      events = listEvents_(calendarId, timeMin, timeMax);
    } catch (e) {
      Logger.log('อ่านปฏิทิน %s ไม่ได้: %s', calKey, e && e.message ? e.message : e);
      return;
    }
    events.forEach(function (ev) {
      if (!ev.startIso) return;                    // นัดทั้งวัน (ไม่มีเวลา) ไม่เกี่ยวกับระบบนี้
      var key = ev.startIso + '|' + (ev.summary || '');
      if (seen[key]) return;                       // ยุบนัด 2 ผู้บริหาร (2 event) เป็นครั้งเดียว
      seen[key] = true;

      var name = callerNameFrom_(ev.description);
      if (!name) return;
      if (exclude[name]) return;                   // ยกเว้นคนที่ไม่ต้องการให้เตือน
      var discordId = nameMap[name];
      if (!discordId) {
        Logger.log('ไม่พบชื่อ "%s" ใน NAME_TO_DISCORD ข้าม (%s)', name, ev.summary || '');
        return;
      }
      var topic = lineAfter_(ev.description, 'หัวข้อ') || ev.summary || '';
      var exec = lineAfter_(ev.description, 'ผู้บริหารที่เข้าร่วม');
      out.push({
        key: key,
        discordId: discordId,
        callerName: name,
        startIso: ev.startIso,
        message: buildMessage_(name, topic, exec, new Date(ev.startIso))
      });
    });
  });
  return out;
}

function buildMessage_(name, topic, exec, startDate) {
  return '⏰ แจ้งเตือนล่วงหน้า ~1 ชั่วโมง\n\n' +
    'คุณ ' + name + ' มีนัดหมายกำลังจะถึงค่ะ\n' +
    '📌 หัวข้อ: ' + topic + '\n' +
    '👤 ผู้บริหาร: ' + exec + '\n' +
    '🗓️ ' + fmtThai_(startDate) + '\n\n' +
    '(ข้อความอัตโนมัติจากระบบนัดหมายผู้บริหาร)';
}

/**
 * คืนค่า [{ startIso, summary, description }] — ใช้ Calendar advanced service ถ้าเปิดไว้,
 * ไม่งั้นถอยไปใช้ CalendarApp (ต้องเห็นปฏิทินนั้นในรายการปฏิทินของบัญชีที่รันสคริปต์)
 */
function listEvents_(calendarId, timeMin, timeMax) {
  if (typeof Calendar !== 'undefined' && Calendar.Events) {
    var res = Calendar.Events.list(calendarId, {
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
      maxResults: 2500
    });
    return (res.items || []).filter(function (ev) {
      return ev.status !== 'cancelled';
    }).map(function (ev) {
      return {
        startIso: ev.start && ev.start.dateTime ? new Date(ev.start.dateTime).toISOString() : '',
        summary: ev.summary || '',
        description: ev.description || ''
      };
    });
  }
  var cal = CalendarApp.getCalendarById(calendarId);
  if (!cal) throw new Error('ไม่พบปฏิทิน ' + calendarId + ' ในบัญชีนี้ (ต้องเปิด Google Calendar API service หรือ subscribe ปฏิทินก่อน)');
  return cal.getEvents(timeMin, timeMax).filter(function (ev) {
    return !ev.isAllDayEvent();
  }).map(function (ev) {
    return {
      startIso: ev.getStartTime().toISOString(),
      summary: ev.getTitle() || '',
      description: ev.getDescription() || ''
    };
  });
}

// --- อ่านค่าจาก description ทีละบรรทัด (เหมือน n8n เดิม) ---
function lineAfter_(desc, label) {
  var lines = String(desc || '').split('\n');
  var pfx = label + ':';
  for (var i = 0; i < lines.length; i++) {
    var ln = lines[i].replace(/\r$/, '');
    if (ln.indexOf(pfx) === 0) return ln.slice(pfx.length).trim();
  }
  return '';
}

function callerNameFrom_(desc) {
  var v = lineAfter_(desc, 'ผู้ขอนัด');     // 'ชื่อ (email)' → เอาเฉพาะชื่อ
  var p = v.indexOf('(');
  return normalize_((p >= 0 ? v.slice(0, p) : v).trim());
}

function normalize_(s) {
  s = String(s || '');
  return typeof s.normalize === 'function' ? s.normalize('NFC') : s;
}

function fmtThai_(d) {
  var dow = Number(Utilities.formatDate(d, TZ, 'u')) % 7;  // 7 (อาทิตย์) → 0
  var da = Number(Utilities.formatDate(d, TZ, 'd'));
  var mo = Number(Utilities.formatDate(d, TZ, 'M'));
  var y = Number(Utilities.formatDate(d, TZ, 'yyyy'));
  var hm = Utilities.formatDate(d, TZ, 'HH:mm');
  return THAI_DOW[dow] + 'ที่ ' + da + ' ' + THAI_MONTHS[mo - 1] + ' ' + (y + 543) + ' เวลา ' + hm + ' น.';
}

function fmtLog_(d) {
  return Utilities.formatDate(d, TZ, 'yyyy-MM-dd HH:mm');
}

// =====================================================================
//  Script Properties: map ชื่อ → Discord ID, รายชื่อยกเว้น, ความจำกันซ้ำ
// =====================================================================

function loadNameMap_() {
  var raw = PropertiesService.getScriptProperties().getProperty('NAME_TO_DISCORD');
  if (!raw) throw new Error('ยังไม่ได้ตั้งค่า Script Property NAME_TO_DISCORD');
  var parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error('NAME_TO_DISCORD ไม่ใช่ JSON ที่ถูกต้อง: ' + e.message);
  }
  var map = {};
  Object.keys(parsed).forEach(function (k) {
    map[normalize_(k.trim())] = String(parsed[k]).trim();
  });
  return map;
}

function loadExcludeSet_() {
  var raw = PropertiesService.getScriptProperties().getProperty('EXCLUDE_NAMES') || '';
  var set = {};
  raw.split(/[,\n]+/).forEach(function (n) {
    n = normalize_(n.trim());
    if (n) set[n] = true;
  });
  return set;
}

function loadReminded_(props) {
  var raw = props.getProperty(PROP_REMINDED);
  var obj = {};
  if (raw) {
    try { obj = JSON.parse(raw) || {}; } catch (e) { obj = {}; }
  }
  var cutoff = Date.now() - DEDUPE_TTL_MS;
  Object.keys(obj).forEach(function (k) {
    if (!(obj[k] > cutoff)) delete obj[k];     // ล้างรายการเก่า ไม่ให้ property โตไปเรื่อยๆ
  });
  return obj;
}

function saveReminded_(props, obj) {
  props.setProperty(PROP_REMINDED, JSON.stringify(obj));
}

// =====================================================================
//  Discord REST API
// =====================================================================

function discordToken_() {
  var t = PropertiesService.getScriptProperties().getProperty('DISCORD_BOT_TOKEN');
  if (!t) throw new Error('ยังไม่ได้ตั้งค่า Script Property DISCORD_BOT_TOKEN');
  return t.trim();
}

function discordFetch_(path, payload) {
  var url = 'https://discord.com/api/v10' + path;
  var options = {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bot ' + discordToken_() },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };
  for (var attempt = 0; attempt < 3; attempt++) {
    var res = UrlFetchApp.fetch(url, options);
    var code = res.getResponseCode();
    var text = res.getContentText();
    if (code >= 200 && code < 300) return text ? JSON.parse(text) : {};
    if (code === 429) {                           // โดน rate limit → รอตามที่ Discord บอกแล้วลองใหม่
      var wait = 1000;
      try { wait = Math.ceil((JSON.parse(text).retry_after || 1) * 1000); } catch (e) { }
      Utilities.sleep(Math.min(wait, 10000));
      continue;
    }
    throw new Error('Discord ' + path + ' ตอบ HTTP ' + code + ': ' + text);
  }
  throw new Error('Discord ' + path + ' โดน rate limit ติดต่อกันหลายครั้ง');
}

/** เปิด DM channel กับผู้ใช้ (cache ไว้ใน properties) แล้วส่งข้อความ */
function sendDiscordDm_(userId, content) {
  var props = PropertiesService.getScriptProperties();
  var cacheKey = PROP_DM_CHANNEL_PREFIX + userId;
  var channelId = props.getProperty(cacheKey);
  if (!channelId) {
    var ch = discordFetch_('/users/@me/channels', { recipient_id: String(userId) });
    channelId = ch.id;
    if (!channelId) throw new Error('เปิด DM channel ไม่ได้: ' + JSON.stringify(ch));
    props.setProperty(cacheKey, channelId);
  }
  try {
    return discordFetch_('/channels/' + channelId + '/messages', { content: content });
  } catch (e) {
    // channel ที่ cache ไว้อาจใช้ไม่ได้แล้ว (เช่น HTTP 404) → ล้าง cache แล้วลองเปิดใหม่อีกครั้งเดียว
    if (/HTTP 404/.test(String(e.message))) {
      props.deleteProperty(cacheKey);
      var ch2 = discordFetch_('/users/@me/channels', { recipient_id: String(userId) });
      props.setProperty(cacheKey, ch2.id);
      return discordFetch_('/channels/' + ch2.id + '/messages', { content: content });
    }
    throw e;
  }
}

// =====================================================================
//  ฟังก์ชันช่วยติดตั้ง / ทดสอบ (กดรันจาก editor)
// =====================================================================

function installTrigger() {
  removeTriggers();
  ScriptApp.newTrigger('sendReminders').timeBased().everyMinutes(INTERVAL_MIN).create();
  Logger.log('ติดตั้ง trigger แล้ว: sendReminders ทุก %s นาที', INTERVAL_MIN);
}

function removeTriggers() {
  var n = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'sendReminders') {
      ScriptApp.deleteTrigger(t);
      n++;
    }
  });
  Logger.log('ถอด trigger เดิมออก %s ตัว', n);
}

function showConfig() {
  var props = PropertiesService.getScriptProperties();
  Logger.log('DISCORD_BOT_TOKEN: %s', props.getProperty('DISCORD_BOT_TOKEN') ? 'ตั้งค่าแล้ว' : '❌ ยังไม่ได้ตั้ง');
  try {
    var map = loadNameMap_();
    Logger.log('NAME_TO_DISCORD: %s ชื่อ → %s', Object.keys(map).length, Object.keys(map).join(', '));
  } catch (e) {
    Logger.log('NAME_TO_DISCORD: ❌ %s', e.message);
  }
  Logger.log('EXCLUDE_NAMES: %s', Object.keys(loadExcludeSet_()).join(', ') || '(ไม่มี)');
  Logger.log('TEST_DISCORD_ID: %s', props.getProperty('TEST_DISCORD_ID') || '(ไม่ได้ตั้ง)');
  Logger.log('Calendar advanced service: %s', (typeof Calendar !== 'undefined') ? 'เปิดอยู่' : 'ไม่ได้เปิด (จะใช้ CalendarApp แทน)');
  Logger.log('trigger ที่ติดตั้ง: %s', ScriptApp.getProjectTriggers().map(function (t) {
    return t.getHandlerFunction();
  }).join(', ') || '(ยังไม่มี)');
  Logger.log('เตือนไปแล้ว (ยังอยู่ในความจำ): %s รายการ', Object.keys(loadReminded_(props)).length);
  Logger.log('เวลาตอนนี้ (ไทย): %s %s', fmtLog_(new Date()), isWeekendBkk_(new Date()) ? '— วันหยุด' : '');
}

function testDiscordDm() {
  var id = PropertiesService.getScriptProperties().getProperty('TEST_DISCORD_ID');
  if (!id) throw new Error('ตั้งค่า Script Property TEST_DISCORD_ID เป็น Discord ID ของตัวเองก่อน');
  sendDiscordDm_(id.trim(), '🔔 ทดสอบระบบแจ้งเตือนนัดหมาย (Apps Script) — ' + fmtThai_(new Date()));
  Logger.log('ส่ง DM ทดสอบหา %s แล้ว ลองดูใน Discord', id);
}

/** ไล่ดูนัดใน 24 ชม.ข้างหน้า: แต่ละนัดอ่านชื่อได้ไหม หา Discord ID เจอไหม (ไม่ส่งอะไรทั้งนั้น) */
function previewNext24h() {
  var now = new Date();
  var end = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  var nameMap = loadNameMap_();
  var exclude = loadExcludeSet_();
  var total = 0;
  Object.keys(CALENDARS).forEach(function (calKey) {
    var events = listEvents_(CALENDARS[calKey], now, end);
    events.forEach(function (ev) {
      total++;
      var name = callerNameFrom_(ev.description);
      var status;
      if (!ev.startIso) status = 'ข้าม (นัดทั้งวัน)';
      else if (!name) status = 'ข้าม (ไม่มีบรรทัด "ผู้ขอนัด:" ใน description)';
      else if (exclude[name]) status = 'ข้าม (อยู่ใน EXCLUDE_NAMES)';
      else if (!nameMap[name]) status = '❌ ไม่พบ "' + name + '" ใน NAME_TO_DISCORD';
      else status = '✅ จะเตือน ' + name + ' (' + nameMap[name] + ')';
      Logger.log('[%s] %s | %s | %s', calKey, ev.startIso ? fmtLog_(new Date(ev.startIso)) : 'ทั้งวัน', ev.summary, status);
    });
  });
  Logger.log('รวม %s event ใน 24 ชม.ข้างหน้า', total);
}

function resetDedupe() {
  var props = PropertiesService.getScriptProperties();
  props.deleteProperty(PROP_REMINDED);
  props.deleteProperty(PROP_LAST_WINDOW_END);
  Logger.log('ล้างความจำ "เตือนไปแล้ว" เรียบร้อย');
}
