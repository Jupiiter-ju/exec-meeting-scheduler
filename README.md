# ระบบนัดหมายผู้บริหาร (Exec Meeting Scheduler)

ระบบสำหรับพนักงานภายในใช้จองคิวนัดหมายผู้บริหาร โดยเช็คความว่างจาก Google Calendar แบบเรียลไทม์ และกันการจองซ้อนอัตโนมัติ

## องค์ประกอบ

- `index.html` — หน้าเว็บฟอร์มสำหรับพนักงาน (เปิดใช้ได้ทันที ไม่ต้อง build)
- `n8n-exec-meeting-workflow.json` — n8n workflow ที่ import ใช้งานได้เลย (ต้องตั้งค่าตามด้านล่างก่อน)

## กติกาที่ระบบใช้

- รับนัดเฉพาะ **จันทร์–ศุกร์ 13:00–16:00 น.**
- ช่องเวลา 30 นาที: 13:00, 13:30, 14:00, 14:30, 15:00, 15:30 (จบ 16:00)
- ปฏิทิน 3 ใบ และกฎการเลือกปฏิทินปลายทางตอนจองจริง:
  - เลือก **คุณกฤช** คนเดียว → สร้าง event ใน **Exe Meeting Schedule**
  - เลือก **คุณเบียร์** คนเดียว → สร้าง event ใน **Combo Meeting Schedule**
  - เลือก **ทั้งคู่** และช่อง "บริษัท/ตัวแทน" **ไม่ใช่** "Agenix"/"AGX" → **สร้าง 2 event แยกกัน** ลงทั้ง Exe Meeting Schedule และ Combo Meeting Schedule (เนื้อหาเหมือนกันทุกอย่าง แค่บันทึกซ้ำในปฏิทินทั้งสองคน)
  - เลือก **ทั้งคู่** และช่อง "บริษัท/ตัวแทน" **เป็น** "Agenix" หรือ "AGX" (ไม่สนตัวพิมพ์เล็ก-ใหญ่) → สร้าง **1 event** ในปฏิทิน **Agenix (AGX) Meeting Schedule** แทน (ปฏิทินเฉพาะของลูกค้า/บริษัท Agenix)
- เวลาที่ "ว่างจริง" ของแต่ละคนต้องเช็คทั้งปฏิทินของตัวเองและปฏิทิน Agenix เสมอ (เพราะนัดในปฏิทิน Agenix ก็กินเวลาจริงของทั้งคู่เช่นกัน) ระบบคำนวณให้อัตโนมัติแล้ว ไม่ว่าสุดท้ายจะไปสร้าง event ที่ปฏิทินไหนก็ตาม
- ถ้าใครเพิ่มนัดในปฏิทินด้วยมือ (ไม่ผ่านเว็บนี้) ระบบจะเห็นว่าช่วงนั้นไม่ว่างทันที เพราะเช็คจากปฏิทินจริงทุกครั้ง ไม่มีการ cache
- ถ้าวันที่เลือกเต็มทั้งวัน ระบบจะเสนอวันถัดไปที่ว่าง (สแกนล่วงหน้า 21 วัน)
- ก่อนบันทึกนัดจริง ระบบเช็คซ้ำอีกครั้ง (กันกรณี 2 คนแย่งจองเวลาเดียวกันพร้อมกัน)
- เมื่อจองสำเร็จ ระบบใส่อีเมลผู้ขอนัดเป็น **attendee** ของ event แล้วสั่ง Google ส่งคำเชิญ (`sendUpdates=all`) — ผู้ขอนัดจะได้อีเมลเชิญแบบมาตรฐานของ Google Calendar (กดตอบรับได้, ขึ้นปฏิทินตัวเองอัตโนมัติ) ส่วนผู้บริหารเป็นเจ้าของปฏิทิน ไม่ใช่ attendee จึงไม่มีอีเมลเชิญส่งไปหา แค่เห็น event โผล่ในปฏิทินเฉยๆ
- มี **ช่วงเวลาห้ามจองประจำ (ถาวรทุกสัปดาห์)** สำหรับผู้บริหารแต่ละคน แม้ปฏิทินจะว่างจริงก็จองไม่ได้ในช่วงนี้:

  | วัน | คุณเบียร์ (combo) | คุณกฤช (exe) |
  |---|---|---|
  | จันทร์ | 13:30–15:30 | 14:00–15:00 |
  | อังคาร | 13:30–14:30 | 14:30–15:00 |
  | พุธ | 13:30–15:00 | 14:00–15:00 |
  | พฤหัส | 13:00–14:00 | 14:30–15:00 |
  | ศุกร์ | 13:30–14:30 | 13:00–14:00 |

  กฎนี้เขียนไว้ตายตัวในโค้ด (ตัวแปร `BLOCKED_TIMES`) ใน 2 จุด: Code node **"Compute Available Slots"** (ตอนแสดงเวลาว่างให้เลือก) และ **"Check Conflict"** (ตอนเช็คซ้ำก่อนบันทึกจองจริง) — ถ้ากติกาเปลี่ยนในอนาคต ต้องแก้ทั้ง 2 จุดให้ตรงกัน

## ขั้นตอนติดตั้ง

### 1) หา Calendar ID ของทั้ง 3 ปฏิทิน

ใน Google Calendar (เว็บ) → ไอคอนเฟือง → ตั้งค่า → เลือกปฏิทินแต่ละใบ (Exe Meeting Schedule / Combo Meeting Schedule / AGX Meeting) ทางซ้าย → เลื่อนไปหา "รวมปฏิทิน" (Integrate calendar) → คัดลอกค่า **Calendar ID** (จะเป็นอีเมลยาวๆ ลงท้ายด้วย `@group.calendar.google.com`)

### 2) Import workflow เข้า n8n

1. เปิด n8n → Import from File → เลือก `n8n-exec-meeting-workflow.json`
2. จะมี 2 Code node ชื่อ **"Build FreeBusy Request (Availability)"** และ **"Build FreeBusy Request (Book Guard)"** — เปิดทั้งคู่แล้วแทนที่
   ```
   REPLACE_WITH_EXE_CALENDAR_ID@group.calendar.google.com
   REPLACE_WITH_COMBO_CALENDAR_ID@group.calendar.google.com
   REPLACE_WITH_AGENIX_CALENDAR_ID@group.calendar.google.com
   ```
   ด้วย Calendar ID จริงจากขั้นตอนที่ 1 (ต้องแก้ให้ตรงกันทั้ง 2 node)
3. ต่อ **Google Calendar credential** (OAuth2) ให้กับ 3 node: `FreeBusy Query`, `FreeBusy Recheck`, `Create Event` — ใช้บัญชี Google ที่มีสิทธิ์แก้ไขทั้ง 3 ปฏิทิน (เลือก "แก้ไขกิจกรรม" ไม่ใช่แค่ดูได้)
4. เปิดใช้งาน (Activate) workflow แล้วคัดลอก **Webhook URL** (Production URL) ของ node "Webhook"

### 2.5) ตั้งค่าแต่ละ Node แบบละเอียด (14 node ทั้งหมด)

ไล่ตามลำดับการทำงานจริง — node ที่มี 🔧 คือต้องแก้ก่อนใช้งาน ที่เหลือตั้งไว้ให้แล้วไม่ต้องแตะ:

| # | Node | ประเภท | ต้องทำอะไร |
|---|------|--------|------------|
| 1 | **Webhook** | Webhook | ไม่ต้องแก้ค่าอะไร (Method=POST, Path=`exec-meeting`, Response Mode=Respond to Webhook Node ตั้งไว้แล้ว) — แค่รอ activate workflow ตอนท้ายแล้วคัดลอก Production URL |
| 2 | **Route by Action** | Switch | ไม่ต้องแก้ — แยกเส้นทางตาม `action` เป็น `get_availability` กับ `book` ให้แล้ว |
| 3 | **Build FreeBusy Request (Availability)** | Code | 🔧 เปิด node → ในกล่องโค้ดบรรทัดบนสุดมี `const CAL = { exe: '...', combo: '...', agenix: '...' }` แทนที่ค่า `REPLACE_WITH_..._CALENDAR_ID@group.calendar.google.com` ทั้ง 3 บรรทัดด้วย Calendar ID จริง |
| 4 | **FreeBusy Query** | HTTP Request | 🔧 แท็บ Credential → เลือก/สร้าง Google Calendar OAuth2 credential (ดูวิธีด้านล่าง) — URL/Method/Body ตั้งไว้แล้ว |
| 5 | **Compute Available Slots** | Code | ไม่ต้องแก้ — คำนวณ slot ว่างจากผล FreeBusy |
| 6 | **Respond Availability** | Respond to Webhook | ไม่ต้องแก้ — ส่ง JSON ผลลัพธ์กลับไปที่ฟอร์ม |
| 7 | **Build FreeBusy Request (Book Guard)** | Code | 🔧 เหมือนข้อ 3 — ต้องแก้ Calendar ID ชุดเดียวกันอีกครั้ง (คนละ node กัน ต้องแก้ทั้งคู่ให้ตรงกัน) |
| 8 | **FreeBusy Recheck** | HTTP Request | 🔧 เลือก credential เดียวกับข้อ 4 |
| 9 | **Check Conflict** | Code | ไม่ต้องแก้ — เช็คว่าช่วงเวลานั้นถูกจองไปแล้วหรือยัง |
| 10 | **Is Available?** | IF | ไม่ต้องแก้ — แยกเส้นทาง ว่าง/ไม่ว่าง |
| 11 | **Split Bookings** | Split Out | ไม่ต้องแก้ — แยกรายการ `bookings` (1 หรือ 2 รายการ แล้วแต่กรณี) ออกเป็นคนละ item เพื่อให้ node ถัดไปสร้าง event ทีละอันอัตโนมัติ |
| 12 | **Create Event** | HTTP Request | 🔧 เลือก credential เดียวกับข้อ 4/8 — นี่คือ node ที่สร้างนัดจริงในปฏิทินและส่งคำเชิญอีเมล (ถ้าเลือก "ทั้งคู่" และไม่ใช่ Agenix/AGX node นี้จะรัน 2 ครั้งอัตโนมัติ สร้าง 2 event) |
| 13 | **Respond Booked** | Respond to Webhook | ไม่ต้องแก้ — รวมผลลัพธ์ event ที่สร้างทั้งหมด (1 หรือ 2 event) ส่งกลับเป็น array เดียว |
| 14 | **Respond Conflict** | Respond to Webhook | ไม่ต้องแก้ |

**วิธีสร้าง Google Calendar OAuth2 credential ครั้งแรก (ทำครั้งเดียว ใช้ซ้ำได้ทั้ง 3 node):**
1. เปิด node **FreeBusy Query** → แท็บ Credential → กด "Create New Credential"
2. n8n จะพาไปหน้า Google OAuth — sign in ด้วยบัญชี Google ที่มีสิทธิ์ **แก้ไขกิจกรรม** (ไม่ใช่แค่ดูได้) บนทั้ง 3 ปฏิทิน (Exe / Combo / Agenix)
3. กด Allow/อนุญาต ให้ n8n เข้าถึง Google Calendar
4. บันทึก credential (ตั้งชื่อเช่น "Google Calendar account")
5. กลับไปที่ node **FreeBusy Recheck** และ **Create Event** → แท็บ Credential → เลือก credential ตัวเดียวกันที่สร้างไว้ (ไม่ต้องสร้างใหม่)

หลังตั้งค่าครบทั้ง 14 node แล้ว กด **Activate** ที่มุมขวาบนของ workflow แล้วคัดลอก **Production URL** จาก node Webhook ไปใช้ในขั้นตอนถัดไป

### 3) ตั้งค่าเว็บฟอร์ม

เปิด `index.html` แก้บรรทัดนี้ในส่วน `<script>`:

```js
const WEBHOOK_URL = 'https://YOUR-N8N-HOST/webhook/exec-meeting';
```

เป็น Webhook URL จริงจากขั้นตอนที่ 2.4 แล้ว host ไฟล์ `index.html` นี้ที่ไหนก็ได้ (internal server, Netlify, Google Sites, หรือแนบไว้ในระบบเว็บพนักงานเดิม) — เข้าถึงได้เฉพาะคนใน org ก็พอ ไม่ต้องมี auth ซับซ้อนเพราะเป็นเครื่องมือภายใน

## วิธีทดสอบ

1. เปิด `index.html` กรอกฟอร์ม เลือกผู้บริหาร เลือกวันที่ (ควรทดสอบวันที่มีนัดอยู่แล้วในปฏิทิน เพื่อดูว่าช่วงนั้นถูกกรองออกจริง)
2. กด "ค้นหาเวลาว่าง" → ควรเห็นเฉพาะช่วงที่ว่างจริง
3. เลือกเวลา → ยืนยัน → เช็คใน Google Calendar ว่ามีนัดใหม่ขึ้นในปฏิทินที่ถูกต้อง (Exe / Combo / Agenix ตามผู้บริหารที่เลือก)
4. ลองจองช่วงเวลาเดียวกันซ้ำ → ระบบควรตอบกลับว่าเวลานี้ถูกจองไปแล้ว

## จุดที่ควรรู้ / ข้อจำกัดเวอร์ชันนี้

- ฟอร์มไม่ตรวจสอบว่า "ชื่อผู้เข้าร่วม" ซ้ำกันหรือสะกดถูกไหม เป็นแค่ช่องข้อความอิสระ
- ผู้บริหารเห็นอีเมลผู้ขอนัดในรายชื่อ "ผู้เข้าร่วม" ของ event เสมอ (ผลข้างเคียงของการใช้กลไกเชิญของ Google Calendar) ถ้าไม่ต้องการให้เห็น ต้องเปลี่ยนไปส่งอีเมลเองผ่าน Gmail node แทน (ไม่ผูก attendee) — ต่อยอดจากแพทเทิร์นใน `n8n-cowork-email-workflow.json` ของโปรเจกต์ booking เดิม
- ไม่ได้แนบลิงก์ Google Meet ให้อัตโนมัติ (นัดพบตัวต่อตัวที่ห้องประชุม) ถ้าภายหลังอยากเพิ่ม ใส่ `conferenceData` ใน `eventBody` ของ Code node "Build FreeBusy Request (Book Guard)" และเพิ่ม query param `conferenceDataVersion=1` ใน node "Create Event"
- ถ้า Code node เจอ input ผิดรูปแบบ (เช่น date ไม่ใช่ YYYY-MM-DD) จะโยน error ธรรมดาของ n8n กลับไป — ฟอร์มหน้าเว็บกันเคสพวกนี้ไว้แล้วในระดับ UI แต่ถ้ามีคนยิง API ตรงๆ ข้ามฟอร์ม จะได้ error ที่ไม่สวย
- รองรับ 21 วันข้างหน้าสำหรับการเสนอ "วันถัดไปที่ว่าง" ปรับเลขนี้ได้ใน Code node "Compute Available Slots" (ตัวแปร loop `i <= 21`)
