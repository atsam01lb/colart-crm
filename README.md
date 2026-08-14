# Colart CRM — Setup

## 1. Create the database (Supabase, free)
1. Go to supabase.com → New project (name it `colart-crm`).
2. Once it's ready: **SQL Editor → New query** → paste everything from `schema.sql` → **Run**.
3. Go to **Authentication → Users → Add user** → create yourself a login (your email + a password). This is what you'll use to log into the CRM — no public sign-up exists.
4. Go to **Project Settings → API** → copy the **Project URL** and the **anon public** key.

## 2. Connect the frontend
Open `js/supabase-client.js` and replace:
```js
const SUPABASE_URL = "YOUR_SUPABASE_URL";
const SUPABASE_ANON_KEY = "YOUR_SUPABASE_ANON_KEY";
```
with the values from step 1.4.

## 3. Push to GitHub + deploy
```
cd colart-crm
git init
git add .
git commit -m "Initial CRM build"
git remote add origin https://github.com/atsam01lb/colart-crm.git
git branch -M main
git push -u origin main
```
Then: repo → **Settings → Pages** → Source: `main` branch, `/root` → Save.

## 4. Point your subdomain at it
In Namecheap DNS for `colartdigitalmarketingagency.com`, add:
- Type: `CNAME`, Host: `crm`, Value: `atsam01lb.github.io`

In the GitHub repo → **Settings → Pages → Custom domain**, enter `crm.colartdigitalmarketingagency.com` and save. Wait for DNS to propagate (up to a few hours), then it's live at that subdomain with HTTPS.

## Notes
- The anon key is safe to expose in the frontend — actual data access is locked by Row Level Security (only logged-in users can read/write).
- To add a teammate later, just add them as a Supabase user — no code changes needed.
- All data lives in Supabase, not in the GitHub repo, so pushing code updates never touches your client data.
