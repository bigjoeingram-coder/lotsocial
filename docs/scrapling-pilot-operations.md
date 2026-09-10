# Scrapling pilot operations

## Configuration

- `LOTSOCIAL_SCRAPLING_ENABLED=false` is the safe default.
- `LOTSOCIAL_SCRAPLING_URL` is the private sidecar origin.
- `LOTSOCIAL_SCRAPLING_TOKEN` is a shared pilot secret; never commit it.
- The container uses Python 3.12.14 and `scrapling==0.4.15` with exact transitive pins in `requirements.lock`.

## Local reproduction

```powershell
$python='python3.12' # or an explicit local Python 3.12 executable
& $python -m venv services\scrapling-parser\.venv
services\scrapling-parser\.venv\Scripts\python.exe -m pip install -r services\scrapling-parser\requirements.lock
$env:PYTHONPATH='services\scrapling-parser\src'
services\scrapling-parser\.venv\Scripts\python.exe -m unittest discover -s services\scrapling-parser\tests -v
node --test tests\scrapling-parser-adapter.test.mjs
```

To run the service, set `LOTSOCIAL_SCRAPLING_TOKEN`, then execute `python -m lotsocial_scrapling.server`. The service exposes `GET /healthz` and authenticated `POST /extract/v1` only.

Run the container with a read-only filesystem, no persistent volume, and private ingress restricted to the LotSocial worker. A temporary writable `/tmp` mount may be supplied only if the container runtime requires it.

## Observability

Logs contain source host, normalized outcome, latency, evidence count, adaptive-use boolean, and extraction version. Raw HTML, URLs with tracking parameters, tokens, cookies, authorization headers, customer records, and extracted page text are excluded.

## Rollback and removal

Set `LOTSOCIAL_SCRAPLING_ENABLED=false`; this bypasses the adapter without changing the existing direct, Bright Data, or listing behavior. Full removal is limited to `app/lib/scrapling-parser.ts`, the three environment fields, the pilot call wrapper in `app/lib/vdp.ts`, and `services/scrapling-parser/`.

## Deployment boundary

This branch is for local build and evidence only. Do not deploy, expose the container publicly, buy hosting, or add browser/network capabilities without Joe's next approval.
