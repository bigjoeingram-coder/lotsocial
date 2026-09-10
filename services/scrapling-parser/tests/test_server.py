from __future__ import annotations

import io
import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from lotsocial_scrapling.server import Handler, MAX_REQUEST_BYTES, MAX_RESPONSE_BYTES, _json_bytes  # noqa: E402
from lotsocial_scrapling.extractor import ExtractionRejected  # noqa: E402


class FakeHandler(Handler):
    def __init__(self, path: str, body: bytes = b"", auth: str = "") -> None:
        self.path = path
        self.headers = {"Content-Length": str(len(body)), "Authorization": auth}
        self.rfile = io.BytesIO(body)
        self.wfile = io.BytesIO()
        self.status = None
        self.response_headers = {}

    def send_response(self, status: int, _message=None) -> None:
        self.status = status

    def send_header(self, key: str, value: str) -> None:
        self.response_headers[key] = value

    def end_headers(self) -> None:
        return


class ServerSecurityTests(unittest.TestCase):
    def test_missing_and_incorrect_auth_are_rejected(self) -> None:
        with patch.dict(os.environ, {"LOTSOCIAL_SCRAPLING_TOKEN": "correct"}, clear=False):
            for auth in ("", "Bearer wrong"):
                handler = FakeHandler("/extract/v1", b"{}", auth)
                handler.do_POST()
                self.assertEqual(handler.status, 401)

    def test_oversized_input_is_rejected_without_reading_body(self) -> None:
        handler = FakeHandler("/extract/v1", b"{}", "Bearer correct")
        handler.headers["Content-Length"] = str(MAX_REQUEST_BYTES + 1)
        with patch.dict(os.environ, {"LOTSOCIAL_SCRAPLING_TOKEN": "correct"}, clear=False):
            handler.do_POST()
        self.assertEqual(handler.status, 413)

    def test_malformed_json_is_rejected(self) -> None:
        handler = FakeHandler("/extract/v1", b"{", "Bearer correct")
        with patch.dict(os.environ, {"LOTSOCIAL_SCRAPLING_TOKEN": "correct"}, clear=False):
            handler.do_POST()
        self.assertEqual(handler.status, 400)

    def test_response_cap_is_enforced(self) -> None:
        with self.assertRaisesRegex(ExtractionRejected, "response_too_large"):
            _json_bytes({"value": "x" * MAX_RESPONSE_BYTES})


if __name__ == "__main__":
    unittest.main()
