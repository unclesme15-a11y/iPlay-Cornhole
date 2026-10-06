# Security

## Reporting a problem

If you find a security problem in iPlay Cornhole (the app, the game server or the website pages), please **do not open a public issue**. Email the address on `https://<game domain>/support` with what you found and how to reproduce it. We aim to reply within 3 days.

## How this project stays safe

- **The server decides every result.** The app only sends what the player did (aim, power, flick); scores and ratings are worked out on the server.
- **Automatic updates:** Dependabot opens a pull request when a library, GitHub Action or Docker base image has a security fix (`.github/dependabot.yml`), and CI tests it before it is merged.
- **Weekly scan:** `.github/workflows/security.yml` checks every library against the public list of known problems every Monday, and on every change to the library list. CI also refuses a change that ships a library with a known high-risk problem.
- **Secrets** (database password, admin token, Vivox and push keys) live only in `deploy/.env` on the server, which is never committed.
- **Login tokens** are stored on the server only as hashes, and on the phone in the iOS Keychain / Android Keystore.
- Details: `docs/operations.md` (running it), `docs/data-and-privacy.md` (what is stored).

## For the repo owner: switch these on once (GitHub settings)

Settings > Code security: turn on **Dependency graph**, **Dependabot alerts** and **Dependabot security updates**. They are free for private repositories. (Secret scanning and CodeQL code scanning need GitHub's paid Advanced Security for private repos; they are free if the repo is ever made public.)
