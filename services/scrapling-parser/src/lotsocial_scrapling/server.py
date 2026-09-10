from __future__ import annotations

import hmac
import json
import logging
import os
import time
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

from . import EXTRACTION_VERSION
from .extractor import ExtractionRejected, extract_vehicle

MAX_REQUEST_BYTES = 3_000_000
MAX_RESPONSE_BYTES = 256_000
logger = logging.getLogger("lotsocial.scrapling")


def _json_bytes(value: object) -> bytes:
    encoded = json.dumps(value, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    if len(encoded) > MAX_RESPONSE_BYTES:
        raise ExtractionRejected("response_too_large")
    return encoded


class Handler(BaseHTTPRequestHandler):
    server_version = "LotSocialScrapling/1"

    def log_message(self, _format: str, *_args: object) -> None:
        return

    def _send(self, status: int, value: object) -> None:
        encoded = _json_bytes(value)
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(encoded)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(encoded)

    def do_GET(self) -> None:  # noqa: N802
        if self.path != "/healthz":
            self._send(HTTPStatus.NOT_FOUND, {"error": "not_found"})
            return
        self._send(HTTPStatus.OK, {"ok": True, "version": EXTRACTION_VERSION})

    def do_POST(self) -> None:  # noqa: N802
        started = time.perf_counter()
        if self.path != "/extract/v1":
            self._send(HTTPStatus.NOT_FOUND, {"error": "not_found"})
            return
        expected_token = os.environ.get("LOTSOCIAL_SCRAPLING_TOKEN", "")
        supplied = self.headers.get("Authorization", "")
        if not expected_token or not hmac.compare_digest(supplied, f"Bearer {expected_token}"):
            self._send(HTTPStatus.UNAUTHORIZED, {"error": "unauthorized"})
            return
        try:
            declared = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            self._send(HTTPStatus.BAD_REQUEST, {"error": "invalid_content_length"})
            return
        if declared <= 0 or declared > MAX_REQUEST_BYTES:
            self._send(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, {"error": "request_too_large"})
            return
        body = self.rfile.read(declared)
        if len(body) > MAX_REQUEST_BYTES:
            self._send(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, {"error": "request_too_large"})
            return
        host = "invalid"
        try:
            payload = json.loads(body)
            if not isinstance(payload, dict):
                raise ExtractionRejected("invalid_payload")
            source_url = payload.get("sourceUrl")
            document = payload.get("html")
            expected_vin = payload.get("expectedVin")
            if not isinstance(source_url, str) or not isinstance(document, str) or (expected_vin is not None and not isinstance(expected_vin, str)):
                raise ExtractionRejected("invalid_payload")
            host = urlsplit(source_url).hostname or "invalid"
            result = extract_vehicle(source_url, document, expected_vin).to_dict()
            self._send(HTTPStatus.OK, result)
            logger.info("extract host=%s outcome=proposed latency_ms=%d fields=%d adaptive=false version=%s", host, int((time.perf_counter() - started) * 1000), len(result["evidence"]), EXTRACTION_VERSION)
        except json.JSONDecodeError:
            self._send(HTTPStatus.BAD_REQUEST, {"error": "malformed_json"})
        except ExtractionRejected as error:
            self._send(HTTPStatus.UNPROCESSABLE_ENTITY, {"error": str(error)})
            logger.info("extract host=%s outcome=rejected latency_ms=%d reason=%s version=%s", host, int((time.perf_counter() - started) * 1000), str(error), EXTRACTION_VERSION)
        except Exception:
            self._send(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": "internal_error"})
            logger.exception("extract host=%s outcome=error version=%s", host, EXTRACTION_VERSION)


def main() -> None:
    logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO"), format="%(levelname)s %(name)s %(message)s")
    host = os.environ.get("HOST", "0.0.0.0")
    port = int(os.environ.get("PORT", "8080"))
    ThreadingHTTPServer((host, port), Handler).serve_forever()


if __name__ == "__main__":
    main()
