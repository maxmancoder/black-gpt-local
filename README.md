# Black GPT Chat

سایت چت شبیه ChatGPT برای مدل‌های لوکال LM Studio — با تاریخچه، چند کاربر، پنل ادمین و تانل عمومی.

## امکانات

- چت با ظاهر ChatGPT (سایدبار، تاریخچه، استریم زنده، Markdown و کد با Copy)
- دریافت خودکار لیست مدل‌ها از LM Studio (مدل جدید = خودکار در سایت)
- انتخاب مدل وسط چت + ذخیره مدل هر پیام
- دیتابیس SQLite (`data/chat.db`) با جدول‌های users / chats / messages
- ورود و ثبت‌نام (bcrypt + Session)
- پنل ادمین کامل: کاربران، مدل‌ها، دسترسی مدل به تفکیک کاربر، آمار، لاگ، تنظیمات
- وضعیت کاربر: آزاد / محدود (سقف چت و پیام) / مسدود
- Rate Limit، صف inference همزمان، System Prompt و Temperature هر چت
- تم تیره/روشن، جستجو در تاریخچه، PWA
- آپلود فایل متنی/کدی و ارسال به مدل به‌عنوان context

## پیش‌نیازها

1. Node.js نسخه 22 یا بالاتر (از `node:sqlite` داخلی استفاده می‌شود)
2. LM Studio باز باشد و سرور مدل اجرا شده باشد (پیش‌فرض `http://127.0.0.1:1234`)

## راه‌اندازی

```bash
npm install
npm start
```

سپس در مرورگر: `http://localhost:3000`

- کاربر پیش‌فرض ادمین: `admin` / `admin1234`
- (در فایل `.env` قابل تغییر است — قبل از اولین اجرا `.env.example` را به `.env` کپی کنید)

## تنظیمات (.env)

| متغیر | پیش‌فرض | توضیح |
|---|---|---|
| PORT | 3000 | پورت سایت |
| LMSTUDIO_URL | http://127.0.0.1:1234 | آدرس API لوکال LM Studio |
| ADMIN_USER | admin | نام کاربر ادمین |
| ADMIN_PASS | admin1234 | رمز ادمین (فقط ساخت اولیه) |
| RATE_LIMIT_MAX | 5 | حداکثر درخواست در بازه |
| RATE_LIMIT_WINDOW_MS | 10000 | بازه Rate Limit (ms) |
| MAX_MESSAGE_CHARS | 10000 | حداکثر طول پیام |
| SESSION_TTL_DAYS | 30 | عمر Session |

## تانل عمومی (Cloudflare Tunnel) برای دوستان

### روش ۱: cloudflared (پیشنهادی، رایگان)

1. نصب cloudflared از https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/
2. اجرا بدون ثبت‌دامنه (URL موقت):

```bash
cloudflared tunnel --url http://localhost:3000
```

3. یک لینک موقت `https://xxx.trycloudflare.com` می‌دهد — همان را به دوستانتان بدهید.

برای دامنه ثابت:

```bash
cloudflared tunnel login
cloudflared tunnel create black-gpt
cloudflared tunnel route dns black-gpt chat.example.com
```

سپس در `~/.cloudflared/config.yml`:

```yaml
tunnel: black-gpt
credentials-file: C:\Users\<you>\.cloudflared\<id>.json
ingress:
  - hostname: chat.example.com
    service: http://localhost:3000
  - service: http_status:404
```

و اجرا:

```bash
cloudflared tunnel run black-gpt
```

### نکات امنیتی تانل

- حتماً رمز ادمین را عوض کنید (پنل ادمین → یا قبل از اجرا در `.env`)
- از پنل ادمین می‌توانید «ثبت‌نام آزاد» را خاموش کنید و کاربر بسازید
- محدودیت سقف پیام/چت برای کاربران محدود از همان پنل قابل تنظیم است

## پنل ادمین

مسیر: `http://localhost:3000/admin`

- داشبورد: آمار کلی، وضعیت LM Studio، نمودار پیام روزانه، پرکاربردترین مدل
- کاربران: ساخت/حذف/مسدود/محدود + سقف چت و پیام + مصرف
- مدل‌ها: فعال/غیرفعال کلی + دسترسی به تفکیک هر کاربر + رفرش از LM Studio
- مصرف و لاگ‌ها و تنظیمات سایت (System Prompt پیش‌فرض، ثبت‌نام آزاد و...)

## ساختار پروژه

```
black GPT chat/
├── server/
│   ├── server.js
│   ├── config.js
│   ├── routes/        (auth, chats, models, files, admin)
│   ├── middleware/    (auth, rateLimit)
│   ├── services/      (lmstudio, queue)
│   └── database/      (database.js, schema.sql)
├── client/            (index, login, admin + css/js)
├── data/chat.db       (ساخته می‌شود)
├── uploads/           (فایل‌های آپلودی)
└── package.json
```

## پشتیبان‌گیری از دیتابیس

فقط فایل `data/chat.db` را کپی کنید. برای بازیابی، همان فایل را سر جایش بگذارید.

## عیب‌یابی

| مشکل | راه حل |
|---|---|
| LM Studio آفلاین نشان می‌دهد | LM Studio باز → تب Developer → Start Server |
| پاسخ نمی‌آید | مدل Load شده؟ در LM Studio یک مدل را Load کنید |
| تانل کار نمی‌کند | پورت 3000 باز است؟ `cloudflared` را دوباره اجرا کنید |
