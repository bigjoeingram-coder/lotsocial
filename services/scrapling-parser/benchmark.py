from __future__ import annotations

import argparse
import json
import statistics
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

SERVICE = Path(__file__).resolve().parent
REPO = SERVICE.parents[1]
sys.path.insert(0, str(SERVICE / "src"))

from lotsocial_scrapling.extractor import ExtractionRejected, extract_vehicle  # noqa: E402


def normalized_vehicle(value: dict[str, Any]) -> dict[str, Any]:
    return {
        "title": value.get("title") or "",
        "vin": (value.get("vin") or "").upper(),
        "stockNumber": value.get("stockNumber") or "",
        "year": value.get("year") or "",
        "make": value.get("make") or "",
        "model": value.get("model") or "",
        "trim": value.get("trim") or "",
        "price": value.get("price") or "",
        "currency": value.get("currency") or "",
        "description": value.get("description") or "",
        "imageUrls": value.get("imageUrls") or [],
        "facts": value.get("facts") or {},
    }


def run_baseline(fixture: Path, source_url: str) -> dict[str, Any]:
    command = ["node", str(REPO / "scripts" / "scrapling-baseline.mjs"), str(fixture), source_url]
    completed = subprocess.run(command, cwd=REPO, capture_output=True, text=True, timeout=36, check=True)
    return json.loads(completed.stdout)


def run_pilot(fixture: Path, source_url: str, expected_vin: str) -> dict[str, Any]:
    html = fixture.read_text(encoding="utf-8")
    started = time.perf_counter()
    try:
        response = extract_vehicle(source_url, html, expected_vin or None).to_dict()
        return {"accepted": True, "vehicle": normalized_vehicle(response["vehicle"]), "latencyMs": (time.perf_counter() - started) * 1000}
    except ExtractionRejected as error:
        return {"accepted": False, "error": str(error), "latencyMs": (time.perf_counter() - started) * 1000}


def field_checks(actual: dict[str, Any], expected: dict[str, Any]) -> list[bool]:
    checks = []
    for key in ("vin", "title", "year", "make", "model"):
        checks.append(str(actual.get(key, "")).casefold() == str(expected.get(key, "")).casefold())
    if expected.get("stockNumber") is not None:
        checks.append(str(actual.get("stockNumber", "")).casefold() == str(expected["stockNumber"]).casefold())
    if expected.get("price") is not None:
        checks.append(str(actual.get("price", "")) == str(expected["price"]))
    checks.append(len(actual.get("imageUrls", [])) >= int(expected.get("usableImageCount", 0)))
    return checks


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", default=str(REPO / "benchmarks" / "scrapling-vdp" / "manifest.json"))
    parser.add_argument("--output", default=str(REPO / "benchmarks" / "scrapling-vdp" / "latest-results.json"))
    args = parser.parse_args()
    manifest_path = Path(args.manifest)
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    entries = manifest.get("fixtures", [])
    positives = [entry for entry in entries if entry.get("kind") == "positive"]
    negatives = [entry for entry in entries if entry.get("kind") == "negative"]
    if len(positives) != 50 or len(negatives) != 10:
        gap = {
            "verdict": "REVISION_NEEDED",
            "reason": "frozen_corpus_incomplete",
            "required": {"positive": 50, "negative": 10},
            "available": {"positive": len(positives), "negative": len(negatives)},
            "missing": {"positive": 50 - len(positives), "negative": 10 - len(negatives)},
        }
        Path(args.output).write_text(json.dumps(gap, indent=2) + "\n", encoding="utf-8")
        print(json.dumps(gap))
        return 2

    rows = []
    baseline_successes = pilot_successes = negative_acceptances = correct_fields = total_fields = 0
    baseline_latencies: list[float] = []
    pilot_latencies: list[float] = []
    deterministic = True
    for entry in entries:
        fixture = manifest_path.parent / entry["fixture"]
        baseline = run_baseline(fixture, entry["sourceUrl"])
        pilot_runs = [run_pilot(fixture, entry["sourceUrl"], entry.get("expected", {}).get("vin", "")) for _ in range(3)]
        normalized_runs = [json.dumps({"accepted": run["accepted"], "vehicle": run.get("vehicle"), "error": run.get("error")}, sort_keys=True) for run in pilot_runs]
        row_deterministic = len(set(normalized_runs)) == 1
        deterministic = deterministic and row_deterministic
        pilot = pilot_runs[0]
        baseline_latencies.append(float(baseline["latencyMs"]))
        pilot_latencies.extend(float(run["latencyMs"]) for run in pilot_runs)
        if entry["kind"] == "positive":
            baseline_successes += int(bool(baseline["accepted"]))
            pilot_successes += int(bool(pilot["accepted"]))
            if pilot["accepted"]:
                checks = field_checks(pilot["vehicle"], entry["expected"])
                correct_fields += sum(checks)
                total_fields += len(checks)
        else:
            negative_acceptances += int(bool(pilot["accepted"]))
        rows.append({"id": entry["id"], "kind": entry["kind"], "baseline": baseline, "pilotRuns": pilot_runs, "deterministic": row_deterministic})

    baseline_failures = 50 - baseline_successes
    pilot_failures = 50 - pilot_successes
    lift_points = (pilot_successes - baseline_successes) * 2
    failure_reduction = ((baseline_failures - pilot_failures) / baseline_failures * 100) if baseline_failures else 0
    sorted_pilot = sorted(pilot_latencies)
    p95 = sorted_pilot[max(0, int(len(sorted_pilot) * 0.95) - 1)]
    summary = {
        "positiveAccepted": pilot_successes,
        "baselinePositiveAccepted": baseline_successes,
        "negativeAccepted": negative_acceptances,
        "fieldAccuracy": correct_fields / total_fields if total_fields else 0,
        "vinFidelity": all(not row["pilotRuns"][0].get("accepted") or row["pilotRuns"][0].get("vehicle", {}).get("vin") == next(item for item in entries if item["id"] == row["id"]).get("expected", {}).get("vin", "") for row in rows if row["kind"] == "positive"),
        "liftPercentagePoints": lift_points,
        "baselineFailureReductionPercent": failure_reduction,
        "deterministic3Of3": deterministic,
        "baselineMedianMs": statistics.median(baseline_latencies),
        "pilotMedianMs": statistics.median(pilot_latencies),
        "pilotP95Ms": p95,
        "endToEndP95Proven": False,
    }
    gates = {
        "positive": pilot_successes >= 49,
        "fields": summary["fieldAccuracy"] >= 0.98,
        "vin": summary["vinFidelity"],
        "negatives": negative_acceptances == 0,
        "incremental": lift_points >= 10 or failure_reduction >= 50,
        "determinism": deterministic,
        "parserLatency": summary["pilotMedianMs"] <= summary["baselineMedianMs"] * 1.2,
        "endToEndLatency": False,
    }
    result = {"verdict": "GO" if all(gates.values()) else "REVISION_NEEDED", "summary": summary, "gates": gates, "fixtures": rows}
    Path(args.output).write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"verdict": result["verdict"], "summary": summary, "gates": gates}))
    return 0 if result["verdict"] == "GO" else 1


if __name__ == "__main__":
    raise SystemExit(main())
