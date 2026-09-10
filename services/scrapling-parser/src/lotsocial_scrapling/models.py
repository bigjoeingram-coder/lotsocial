from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any


@dataclass(frozen=True)
class FieldEvidence:
    selector: str | None
    rawValue: str | None


@dataclass
class VehicleCandidate:
    title: str | None = None
    vin: str | None = None
    stockNumber: str | None = None
    year: str | None = None
    make: str | None = None
    model: str | None = None
    trim: str | None = None
    price: str | None = None
    currency: str | None = None
    description: str | None = None
    imageUrls: list[str] = field(default_factory=list)
    facts: dict[str, str] = field(default_factory=dict)


@dataclass
class ExtractionResponse:
    extractionVersion: str
    adaptiveMatchUsed: bool
    vehicle: VehicleCandidate
    evidence: dict[str, FieldEvidence | list[FieldEvidence]]
    warnings: list[str]

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)
