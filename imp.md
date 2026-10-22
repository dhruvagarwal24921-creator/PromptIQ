# 🚀 Important Commands — Cloudflare Worker Deployment

Follow these commands to deploy or update your PromptIQ backend on the Cloudflare Workers edge network.

---

### Step 0: Open Terminal in `cloudflare-worker` directory
```cmd
cd cloudflare-worker
```

---

### Command 1: Login to Cloudflare
Run this command once to authenticate your Cloudflare account:
```cmd
npx --package=wrangler --package=@cloudflare/workerd-windows-64 wrangler login
```

> 💡 **Tip for Incognito Window:**
> When you run `wrangler login`, Wrangler prints an authorization URL in the terminal (e.g. `https://dash.cloudflare.com/oauth2/auth?...`).
> 1. Copy that URL from the terminal.
> 2. Paste it into your **Incognito window** (where your Cloudflare account is already logged in) and press Enter.
> 3. Click **Allow** on the screen.
> 4. The terminal will immediately detect it and show `Successfully logged in`.

---

### Command 2: Configure Secrets
Store your Dahl API key securely in Cloudflare:
```cmd
npx wrangler secret put DAHL_API_KEY
```
*(Enter your Dahl API key when prompted).*

---

### Command 3: Deploy / Update to Cloudflare
Run this command whenever you change the code in `src/index.js` or `wrangler.toml`:
```cmd
npx --package=wrangler --package=@cloudflare/workerd-windows-64 wrangler deploy
```

---

### 🌐 Live Worker Endpoint
Once deployed, your live API endpoint will look like:
```text
https://promptiq-backend.<your-cloudflare-subdomain>.workers.dev
```
Make sure this URL is entered in your PromptIQ extension popup under **Backend URL**.
