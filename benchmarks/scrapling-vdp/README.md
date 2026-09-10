# Scrapling VDP frozen benchmark corpus

The approved gate requires 50 confirmed VDP HTML fixtures and 10 negative controls. None were supplied with Relay row 1215, and this branch does not fabricate expected values.

Each future manifest entry must point to a scrubbed local HTML file and contain:

- `id`, `kind`, `fixture`, `sourceUrl`, `captureDate`, and `platform`
- for positives, exact expected `vin`, `title`, `year`, `make`, `model`, optional `stockNumber`, optional `price`, and `usableImageCount`
- `baselineFailureMode`, verified from the frozen fixture

Tracking parameters and personal information must be removed before a fixture is committed. Run the identical manifest through:

```powershell
$env:PYTHONPATH='services\scrapling-parser\src'
services\scrapling-parser\.venv\Scripts\python.exe services\scrapling-parser\benchmark.py
```

`latest-results.json` is generated evidence. A missing 50/10 corpus returns exit code 2 and `REVISION_NEEDED`; it can never be interpreted as a passing benchmark.
