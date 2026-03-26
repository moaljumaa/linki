<p align="center">
  <img src="public/logo_linki.png" alt="Linki" width="56" />
</p>

<h1 align="center">Linki</h1>
<p align="center">Self-hosted LinkedIn outreach automation. Build campaigns, import leads, and run multi-step sequences — all from your own server.</p>

<p align="center">
  <a href="https://opsily.com/hosting/linki?utm_source=github&utm_medium=readme&utm_campaign=linki">
    <img src="public/deploy-with-opsily.svg" alt="Deploy with Opsily" height="36" />
  </a>
</p>

---

<p align="center">
  <strong>▶ Full demo — click to watch &nbsp;|&nbsp;</strong>
  <a href="https://youtu.be/7Tgv-wd2Jh0">https://youtu.be/7Tgv-wd2Jh0</a>
</p>
<p align="center">
  <a href="https://youtu.be/7Tgv-wd2Jh0">
    <img src="https://img.youtube.com/vi/7Tgv-wd2Jh0/maxresdefault.jpg" alt="Click to watch the full demo on YouTube" width="720" />
  </a>
</p>

---

## What is Linki

Linki is an open-source alternative to tools like Lemlist and Waalaxy. You define a multi-step outreach campaign — visit a profile, send a connection request, wait a day, send a message — and Linki runs it automatically against your LinkedIn Sales Navigator lead lists using a real browser.

Your data stays on your machine. No SaaS middleman. No per-seat pricing.

## Features

- **Multi-step campaigns** — chain visit → connect → delay → message in any order
- **Sales Navigator import** — paste a Sales Navigator list URL and Linki imports all leads automatically
- **Per-lead state tracking** — see exactly where each lead is in the campaign
- **Daily limits** — set max connections and messages per day per account
- **Multiple LinkedIn accounts** — manage and switch between accounts
- **Live campaign dashboard** — monitor progress, view logs, pause or stop at any time
- **Invite-code auth** — single-user login so only you can access your instance

---

## Hosting options

### One-click on Opsily (recommended)

[Opsily](https://opsily.com) is the easiest way to run Linki. Create a server, deploy Linki from the app store, and you get a live URL in under a minute — no terminal required.

[![Deploy with Opsily](public/deploy-with-opsily.svg)](https://opsily.com/hosting/linki)

### Self-host with Docker

**1. Create your environment file**

```bash
cp .env.example .env.local
```

Fill in `.env.local`:

```env
# Public URL of the app (e.g. https://linki.yourdomain.com or http://localhost:3456)
NEXTAUTH_URL=http://localhost:3456

# Random secret — generate with: openssl rand -base64 32
NEXTAUTH_SECRET=your_random_secret_here

# Password to log in to the Linki UI
AUTH_PASSWORD=your_password_here
```

**2. Start the container**

```bash
docker compose up -d
```

Linki is now running at `http://localhost:3456`.

The SQLite database is persisted in `./data/linki.db` on your host machine.

### Self-host manually (Node.js)

Requires Node.js 22+.

```bash
npm install
npm run build
npm start
```

Set the environment variables above in your shell or a `.env.local` file before running.

---

## Setup

### 1. Add a LinkedIn account

Go to **Accounts → Add account**. Enter a name and set your daily limits (recommended: 20 connections/day, 30 messages/day to stay safe).

### 2. Authenticate

After adding an account, click **Authenticate** and follow the on-screen steps to connect it to your LinkedIn session via cookies.

### 3. Import a lead list

Go to **Lists → New list**. Paste a LinkedIn Sales Navigator list URL and click **Import**. Linki will pull in all leads from that list.

> **Note:** A LinkedIn Sales Navigator subscription is required to import leads.

### 4. Build a campaign

Go to **Campaigns → New campaign**. Select your list, define your steps (visit, connect, message), choose delays between steps, pick your account, and launch.

---

## License

Linki is source-available under the [Linki Sustainable Use License](LICENSE).

**You can:** use it personally, use it for your business, self-host it on your own VPS or laptop, modify it, contribute to it.
