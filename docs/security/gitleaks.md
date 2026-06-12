# Gitleaks Secret Scanning

This repository uses Gitleaks to block newly committed secrets.

## Local Scan

```bash
scripts/install-gitleaks.sh
pnpm run secret:scan
```

The scan uses `.gitleaks.toml` and `.gitleaks-baseline.json`.

## Baseline Policy

`.gitleaks-baseline.json` contains redacted fingerprints for findings that
already existed in git history before CI secret scanning was enabled. It does
not allow new findings: new secrets produce new fingerprints and fail
`pnpm run secret:scan`.

If an old baseline entry was a real credential, rotate it. A baseline only keeps
CI usable; it does not make leaked historical credentials safe.

## CI Coverage

GitHub Actions install Gitleaks before dependency installation and run
`pnpm run secret:scan` in:

- `CI`
- `Deploy Hetzner`
- `Build APK`
