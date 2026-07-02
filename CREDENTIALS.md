# 🔐 Encrypted Credentials

All tokens, API keys, and connection strings for this project are stored **encrypted** in `.credentials.enc`.

## How to decrypt

```bash
openssl enc -aes-256-cbc -d -in .credentials.enc -out .env -pass pass:<PASSWORD> -pbkdf2 -iter 10000
```

## Password hint

> The password is the name of a **country**. 🌍
>
> - It's in Africa
> - 8 letters
> - Starts with "E"
> - Known for coffee's origin
> - Capital is Addis Ababa

## What's inside

The decrypted file (`.env`) contains:

| Key | Service | Purpose |
|-----|---------|---------|
| `GITHUB_TOKEN` | GitHub | Repo push/pull, auto-commit watcher |
| `VERCEL_TOKEN` | Vercel | Deploy to production |
| `RAILWAY_TOKEN` | Railway | Worker deployment management |
| `RAILWAY_PROJECT_ID` | Railway | Project identifier |
| `RAILWAY_SERVICE_ID` | Railway | Service identifier |
| `DATABASE_URL` | Neon Postgres | Database connection (unpooled) |
| `DATABASE_URL_POOLED` | Neon Postgres | Database connection (pooled) |
| `MISTRAL_API_KEY` | Mistral AI | Free-tier LLM for owner extraction, lead scoring, email generation |
| `WEBSHARE_PROXY_USER` | Webshare | Proxy username |
| `WEBSHARE_PROXY_PASS` | Webshare | Proxy password |
| `ADMIN_EMAIL` | Lead Scraper | Admin login email |
| `ADMIN_PASSWORD` | Lead Scraper | Admin login password |
| `NEXTAUTH_SECRET` | NextAuth | JWT signing secret |

## Security notes

- The plaintext `.credentials` file is in `.gitignore` and will **never** be committed
- Only the encrypted `.credentials.enc` file is on GitHub
- AES-256-CBC with PBKDF2 key derivation (10,000 iterations)
- Change the password by re-encrypting:
  ```bash
  openssl enc -aes-256-cbc -in .credentials -out .credentials.enc -pass pass:<NEW_PASSWORD> -pbkdf2 -iter 10000
  ```

## For AI agents

If you're an AI agent (Claude, GLM, etc.) picking up this project:
1. Ask the user for the decryption password (or check if they've provided it)
2. Run the decrypt command above to generate `.env`
3. All tokens will be available as environment variables
4. See `CLAUDE.md` or `GLM.md` for full project setup instructions
