from __future__ import annotations

import html as html_module
import ipaddress
import json
import re
from collections.abc import Iterable
from urllib.parse import urljoin, urlsplit

from scrapling import Selector

from . import EXTRACTION_VERSION
from .models import ExtractionResponse, FieldEvidence, VehicleCandidate

VIN_RE = re.compile(r"\b[A-HJ-NPR-Z0-9]{17}\b", re.IGNORECASE)
RAW_CHALLENGE_RE = re.compile(
    r"cf-chl|cdn-cgi/challenge-platform",
    re.IGNORECASE,
)
VISIBLE_CHALLENGE_RE = re.compile(
    r"just a moment|attention required|checking if the site connection is secure|verify you are human|complete the security check",
    re.IGNORECASE,
)
NEGATIVE_TITLE_RE = re.compile(
    r"(?:new|used|pre-owned)?\s*(?:cars|vehicles|inventory)\s+(?:for sale|search)|privacy|consent|access denied|page not found|404|login",
    re.IGNORECASE,
)
BAD_IMAGE_RE = re.compile(r"logo|icon|avatar|pixel|badge|spacer|tracking|favicon|loader|placeholder", re.IGNORECASE)
VEHICLE_TYPES = {"vehicle", "car", "product", "individualproduct"}


class ExtractionRejected(ValueError):
    """The supplied document is not safe enough to propose as a VDP."""


def validate_public_source_url(value: str) -> str:
    parsed = urlsplit(value)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username or parsed.password:
        raise ExtractionRejected("source_url_not_public")
    host = parsed.hostname.lower().rstrip(".")
    if host == "localhost" or host.endswith((".local", ".internal", ".localhost")):
        raise ExtractionRejected("source_url_not_public")
    try:
        address = ipaddress.ip_address(host)
    except ValueError:
        address = None
    if address and not address.is_global:
        raise ExtractionRejected("source_url_not_public")
    if parsed.port not in {None, 80, 443}:
        raise ExtractionRejected("source_url_not_public")
    return value


def _flatten_json(value: object) -> Iterable[dict[str, object]]:
    if isinstance(value, list):
        for item in value:
            yield from _flatten_json(item)
    elif isinstance(value, dict):
        yield value
        yield from _flatten_json(value.get("@graph"))
        yield from _flatten_json(value.get("itemListElement"))


def _text(value: object) -> str:
    if isinstance(value, (str, int, float)):
        return str(value).strip()
    if isinstance(value, dict):
        return _text(value.get("name") or value.get("url") or value.get("contentUrl"))
    return ""


def _types(node: dict[str, object]) -> set[str]:
    value = node.get("@type")
    values = value if isinstance(value, list) else [value]
    return {str(item).lower() for item in values if isinstance(item, str)}


def _clean(value: str) -> str:
    return re.sub(r"\s+", " ", html_module.unescape(value)).strip()


def _price(value: object) -> str:
    raw = _text(value)
    match = re.search(r"(?:USD\s*)?\$?\s*([\d,]+(?:\.\d{1,2})?)", raw, re.IGNORECASE)
    if not match:
        return ""
    amount = float(match.group(1).replace(",", ""))
    return str(int(amount)) if amount >= 1000 and amount.is_integer() else (str(amount) if amount >= 1000 else "")


def _meta(page: Selector, key: str) -> tuple[str, str] | None:
    for attribute in ("property", "name"):
        matches = page.css(f'meta[{attribute}="{key}"]')
        if matches:
            value = _clean(str(matches[0].attrib.get("content", "")))
            if value:
                return value, f'meta[{attribute}="{key}"]'
    return None


def _first_element(page: Selector, selectors: Iterable[str]) -> tuple[str, str, object] | None:
    for css in selectors:
        matches = page.css(css)
        if not matches:
            continue
        element = matches[0]
        raw = _clean(str(element.attrib.get("content") or element.attrib.get("value") or element.get_all_text(" ", strip=True)))
        if raw:
            return raw, css, element
    return None


def _usable_image(raw: str, source_url: str) -> str | None:
    if not raw or BAD_IMAGE_RE.search(raw):
        return None
    resolved = urljoin(source_url, html_module.unescape(raw))
    parsed = urlsplit(resolved)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc or re.search(r"\.(svg|ico|gif|pdf)$", parsed.path, re.IGNORECASE):
        return None
    return resolved


def extract_vehicle(source_url: str, document: str, expected_vin: str | None = None) -> ExtractionResponse:
    validate_public_source_url(source_url)
    if not isinstance(document, str) or not document.strip():
        raise ExtractionRejected("empty_html")
    if RAW_CHALLENGE_RE.search(document[:200_000]):
        raise ExtractionRejected("challenge_or_interstitial")

    page = Selector(document, url=source_url, adaptive=False)
    visible = _clean(str(page.get_all_text(" ", strip=True)))
    if VISIBLE_CHALLENGE_RE.search(visible[:20_000]):
        raise ExtractionRejected("challenge_or_interstitial")
    title_element = _first_element(page, ("h1[itemprop='name']", "h1.vehicle-title", "h1.vdp-title", "main h1", "h1"))
    title_meta = _meta(page, "og:title")
    html_title = _first_element(page, ("title",))
    title_tuple = title_element or ((title_meta[0], title_meta[1], None) if title_meta else None) or html_title
    page_title = title_tuple[0] if title_tuple else ""
    if page_title and NEGATIVE_TITLE_RE.search(page_title):
        raise ExtractionRejected("negative_page_type")

    nodes: list[tuple[dict[str, object], str]] = []
    for index, script in enumerate(page.css('script[type="application/ld+json"]')):
        raw = str(script.text).strip()
        if not raw:
            continue
        try:
            decoded = json.loads(raw)
        except (json.JSONDecodeError, TypeError):
            continue
        nodes.extend((node, f'script[type="application/ld+json"]:nth-of-type({index + 1})') for node in _flatten_json(decoded))
    vehicle_node, vehicle_selector = next(((node, selector) for node, selector in nodes if _types(node) & VEHICLE_TYPES), ({}, ""))

    vehicle = VehicleCandidate()
    evidence: dict[str, FieldEvidence | list[FieldEvidence]] = {}

    def set_field(name: str, value: object, selector: str, raw: object | None = None) -> None:
        cleaned = _clean(_text(value))
        if not cleaned:
            return
        setattr(vehicle, name, cleaned)
        evidence[name] = FieldEvidence(selector or None, _clean(_text(raw if raw is not None else value)) or None)

    set_field("title", vehicle_node.get("name") or page_title, vehicle_selector or (title_tuple[1] if title_tuple else ""), vehicle_node.get("name") or page_title)
    set_field("vin", vehicle_node.get("vehicleIdentificationNumber") or vehicle_node.get("vin"), vehicle_selector)
    set_field("stockNumber", vehicle_node.get("sku"), vehicle_selector)
    set_field("year", vehicle_node.get("vehicleModelDate"), vehicle_selector)
    set_field("make", vehicle_node.get("brand") or vehicle_node.get("manufacturer"), vehicle_selector)
    set_field("model", vehicle_node.get("model"), vehicle_selector)
    set_field("trim", vehicle_node.get("vehicleConfiguration") or vehicle_node.get("trim"), vehicle_selector)
    set_field("description", vehicle_node.get("description"), vehicle_selector)

    if not vehicle.vin:
        vin_element = _first_element(page, ("[itemprop='vehicleIdentificationNumber']", "[data-vin]", ".vin", "#vin"))
        match = VIN_RE.search(vin_element[0] if vin_element else visible)
        if match:
            vehicle.vin = match.group(0).upper()
            evidence["vin"] = FieldEvidence(vin_element[1] if vin_element else "document-visible-text", match.group(0))
    if not vehicle.stockNumber:
        stock_element = _first_element(page, ("[itemprop='sku']", "[data-stock]", ".stock-number", ".stock", "#stock"))
        stock_match = re.search(r"(?:Stock(?:\s*(?:#|Number))?\s*[:#]?\s*)?([A-Z0-9-]{2,})", stock_element[0], re.IGNORECASE) if stock_element else None
        if stock_element and stock_match:
            vehicle.stockNumber = stock_match.group(1)
            evidence["stockNumber"] = FieldEvidence(stock_element[1], stock_element[0])

    offers = vehicle_node.get("offers")
    if isinstance(offers, list):
        offers = next((item for item in offers if isinstance(item, dict)), {})
    offers = offers if isinstance(offers, dict) else {}
    raw_price = offers.get("price") or offers.get("lowPrice")
    if not raw_price and isinstance(offers.get("priceSpecification"), dict):
        raw_price = offers["priceSpecification"].get("price")
    price_selector = vehicle_selector
    if not raw_price:
        price_element = _first_element(page, ("[itemprop='price']", "[data-price]", ".vehicle-price", ".price", "#price"))
        if price_element:
            raw_price, price_selector = price_element[0], price_element[1]
    normalized_price = _price(raw_price)
    if normalized_price:
        vehicle.price = normalized_price
        vehicle.currency = _text(offers.get("priceCurrency")) or "USD"
        evidence["price"] = FieldEvidence(price_selector or None, _text(raw_price))
        evidence["currency"] = FieldEvidence(price_selector or None, _text(raw_price))

    fact_map = {
        "exteriorColor": vehicle_node.get("color"),
        "interiorColor": vehicle_node.get("vehicleInteriorColor"),
        "transmission": vehicle_node.get("vehicleTransmission"),
        "fuelType": vehicle_node.get("fuelType"),
        "drivetrain": vehicle_node.get("driveWheelConfiguration"),
        "bodyStyle": vehicle_node.get("bodyType"),
    }
    for key, value in fact_map.items():
        cleaned = _clean(_text(value))
        if cleaned:
            vehicle.facts[key] = cleaned
            evidence[f"facts.{key}"] = FieldEvidence(vehicle_selector or None, cleaned)

    image_candidates: list[tuple[str, str]] = []
    structured_images = vehicle_node.get("image")
    structured_images = structured_images if isinstance(structured_images, list) else [structured_images]
    for value in structured_images:
        raw = _text(value)
        if raw:
            image_candidates.append((raw, vehicle_selector))
    og_image = _meta(page, "og:image")
    if og_image:
        image_candidates.append((og_image[0], og_image[1]))
    for css in ("img[itemprop='image']", ".vehicle-gallery img", ".vdp-gallery img", "[data-gallery] img"):
        for element in page.css(css):
            raw = _text(element.attrib.get("src") or element.attrib.get("data-src") or element.attrib.get("data-lazy-src"))
            if raw:
                image_candidates.append((raw, css))
    seen: set[str] = set()
    image_evidence: list[FieldEvidence] = []
    for raw, selector in image_candidates:
        resolved = _usable_image(raw, source_url)
        if resolved and resolved not in seen:
            seen.add(resolved)
            vehicle.imageUrls.append(resolved)
            image_evidence.append(FieldEvidence(selector or None, raw))
            if len(vehicle.imageUrls) == 24:
                break
    if image_evidence:
        evidence["imageUrls"] = image_evidence

    if not vehicle.title:
        raise ExtractionRejected("missing_vehicle_title")
    expected = (expected_vin or "").strip().upper()
    if expected and (not VIN_RE.fullmatch(expected) or vehicle.vin != expected):
        raise ExtractionRejected("expected_vin_mismatch")
    if not vehicle.vin and not (vehicle.year and (vehicle.make or vehicle.model)):
        raise ExtractionRejected("insufficient_vehicle_evidence")

    return ExtractionResponse(
        extractionVersion=EXTRACTION_VERSION,
        adaptiveMatchUsed=False,
        vehicle=vehicle,
        evidence=evidence,
        warnings=[],
    )
