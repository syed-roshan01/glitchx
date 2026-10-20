# WhatsApp receipt relay

Runs your WhatsApp (linked via QR) and delivers GlitchX invoice PDFs to
customers automatically. Runs on the shop PC — the web app (Vercel) cannot
host it.

## Setup (once)

```powershell
cd whatsapp-relay
copy .env.example .env      # then edit: APP_URL + RELAY_TOKEN
npm install
npm start
```

Then open **Admin → WhatsApp** in the app and scan the QR with your phone
(**WhatsApp → Settings → Linked Devices → Link a Device**).

Set the same `RELAY_TOKEN` value in the app's environment:

- **Production (Vercel):** Settings → Environment Variables → `WHATSAPP_RELAY_TOKEN`
- **Local dev:** `.env.local` → `WHATSAPP_RELAY_TOKEN=...`

## Notes

- The `session/` folder holds your linked WhatsApp session — keep it private.
- Queued messages live in the database: after a power cut nothing is lost,
  receipts go out when this relay is back online.
- Unofficial automation — use a **dedicated shop number**, not your personal
  WhatsApp. Only invoice receipts are sent, with a delay between messages.
