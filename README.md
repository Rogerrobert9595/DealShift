# DealShift

An automotive sales desk simulator and ownership digital twin designed to model real-world vehicle equity, depreciation crossovers, and total cost of ownership (TCO) side-by-side with lot inventory.

---

## ⚡ Overview

DealShift bridges dealership lot management and consumer finance clarity. Instead of looking solely at a monthly note, the application models true monthly cash outlay by pairing real-time loan amortization against vehicle operational costs (fuel economy, maintenance index, depreciation, and equity crossover points).

### Key Features

- **Dealership Desk Simulator:** Adjust vehicle price, down payment, trade allowance, APR, and terms (48–84 months) with instant payment calculations.
- **Equity Crossover & Depreciation Twin:** Visualizes loan payoff curves against estimated vehicle depreciation to pinpoint the exact month of positive trade equity.
- **Real-Time VIN Decoding & Specs:** Integrates with the public NHTSA VPIC API to resolve VINs into displacement, cylinder counts, and drive type.
- **EPA Fuel & Maintenance Indexing:** Connects to Fueleconomy.gov endpoints and algorithmic brand-level maintenance curves to project realistic operational overhead, with automatic regional fuel pricing tied to the entered 5-digit ZIP code.
- **Google Sheets & CRM Sync:** Ingests live dealership inventory directly via Google Apps Script web endpoints.
- **Cloudflare D1 Accounts & Saved Deals:** Optional salesperson accounts backed by Cloudflare D1 (SQLite) and Web Crypto PBKDF2 authentication for saving customer deal structures and syncing inventory sheet URLs across devices.
- **Mobile-First PWA:** Built to run responsively on mobile devices and showroom tablets.

---

## 🛠️ Tech Stack

- **Framework:** [TanStack Start](https://tanstack.com/start) / React 19 with TypeScript
- **Styling & UI:** Tailwind CSS v4, Radix UI primitives, Lucide Icons
- **Database & Auth:** Cloudflare D1 (SQLite), Drizzle ORM, Web Crypto (`crypto.subtle` PBKDF2-SHA256)
- **Runtime & Deployment:** Cloudflare Workers (`wrangler`), Nitro (`cloudflare-module`), Vite

---

## 🚀 Getting Started

### Prerequisites

Ensure you have [Node.js](https://nodejs.org/) (v20+) or [Bun](https://bun.sh/) installed locally.

### Installation & Local Development

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Start the local development server:**
   ```bash
   npm run dev
   ```
   > In local `vite dev` without a Wrangler D1 binding, `src/lib/cloudflare.server.ts` automatically falls back to an in-memory store so authentication and saved deals work out of the box.

---

## ☁️ Deploying to Cloudflare Workers & D1

1. **Authenticate Wrangler with your Cloudflare account:**
   ```bash
   npx wrangler login
   ```

2. **Create your Cloudflare D1 database:**
   ```bash
   npx wrangler d1 create dealshift-db
   ```
   Copy the `database_id` output by Wrangler and paste it into `wrangler.jsonc` under `d1_databases[0].database_id`.

3. **Apply the D1 database schema migration:**
   - **Local D1 preview database:**
     ```bash
     npm run db:migrate:local
     ```
   - **Production Cloudflare D1 database:**
     ```bash
     npm run db:migrate:remote
     ```
   *(Note: The Worker also auto-initializes missing tables on its first request as a safety net.)*

4. **(Optional) Configure transactional password-reset emails:**
   If you want password reset links emailed via [Resend](https://resend.com) (otherwise the reset link is displayed directly in the UI):
   ```bash
   npx wrangler secret put RESEND_API_KEY
   npx wrangler secret put RESEND_FROM_EMAIL
   ```

5. **Build and deploy to Cloudflare Workers:**
   ```bash
   npm run deploy
   ```
