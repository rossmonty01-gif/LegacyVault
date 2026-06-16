# LegacyVault

LegacyVault is a full-stack MVP for a secure digital estate planning and family wealth management vault. It helps individuals and families record documents, assets, liabilities, contacts, beneficiaries, emergency access requests and professional adviser notes in one place.

## Audience

LegacyVault is designed for:

- Individuals and families aged 50+
- Spouses and emergency contacts
- Executors and beneficiaries
- Financial advisers
- Attorneys and estate planners
- Administrators

## Features

- Email and password authentication with PBKDF2 password hashing
- HttpOnly session cookies and basic security headers
- Role-aware user profile support for Owner, Spouse / Emergency Contact, Executor, Beneficiary, Financial Adviser, Attorney / Estate Planner and Admin
- Password reset and two-factor authentication placeholders
- Dashboard with assets, liabilities, net worth, estate duty, executor fee and liquidity estimates
- Document vault with categories, notes, permissions and secure upload folder structure
- Asset and liability registers
- South African estate planning calculators using placeholder assumptions
- Contacts, family access and beneficiary notification sections
- Adviser / professional portal placeholder
- Pricing page
- SQLite database with seed data
- Audit log for key actions

## Pages

- Landing, register and login
- Dashboard
- Documents and add document
- Assets and add asset
- Liabilities and add liability
- Estate calculators
- Contacts
- Family access
- Beneficiaries
- Adviser portal
- Pricing
- Settings

## Important disclaimer

LegacyVault does not replace legal, tax or financial advice. Estate duty and executor fee calculations are estimates only. Users should consult a qualified financial adviser, attorney or tax practitioner.

## Requirements

- Node.js 24 or newer

This MVP intentionally avoids third-party server dependencies so it can run in a lightweight environment. It uses Node's built-in SQLite support.

## Quick start

1. Copy the environment file:

```bash
cp .env.example .env
```

2. Update `.env` values, especially `SESSION_SECRET`.

3. Start the app:

```bash
npm run dev
```

If your environment does not have `npm`, run:

```bash
node server.mjs
```

4. Open:

```text
http://localhost:3000
```

5. Check the health endpoint:

```bash
curl http://localhost:3000/api/health
```

## Demo account

```text
Email: owner@legacyvault.demo
Password: LegacyVault123!
```

There is also a seeded adviser account:

```text
Email: adviser@legacyvault.demo
Password: LegacyVault123!
```

## Project structure

```text
.github/workflows/ci.yml   GitHub Actions smoke test
docs/DEPLOYMENT.md         Deployment guide
server.mjs                 Node API server and static file server
src/db.mjs                 SQLite schema and seed data
public/                    React app, styles and static entry point
public/vendor/             Vendored React browser runtime
scripts/seed.mjs           Seed command
data/                      SQLite database location
uploads/                   Uploaded document storage
```

## Environment variables

Create `.env` from `.env.example`:

```text
PORT=3000
HOST=127.0.0.1
SESSION_SECRET=replace-with-a-long-random-secret
DATABASE_PATH=./data/legacyvault.sqlite
UPLOAD_DIR=./uploads
EMERGENCY_ACCESS_DELAY_DAYS=7
```

Use a long random `SESSION_SECRET` in production. Keep `.env`, SQLite databases and uploaded files out of Git.

## Deployment

LegacyVault can run on any Node.js 24 host with persistent storage.

Basic production command:

```bash
NODE_ENV=production node server.mjs
```

For platform-specific guidance, see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

Deployment checklist:

- Set all environment variables.
- Set `HOST=0.0.0.0` if your hosting platform requires binding to all interfaces.
- Use persistent storage for `data/` and `uploads/`.
- Route traffic to the configured `PORT`.
- Confirm `/api/health` returns `ok: true`.
- Configure backups before storing real user data.

## GitHub workflow

The repository includes a GitHub Actions smoke test at `.github/workflows/ci.yml`. It uses Node.js 24, seeds the database, starts the app and checks `/api/health`.

## Security notes for production

Before production use, add encrypted file/object storage, CSRF protection, full two-factor authentication, email delivery, stricter role-based policies per record, malware scanning for uploads, backup/retention policies, legal consent flows and professional security testing.

## License

MIT. See [LICENSE](LICENSE).