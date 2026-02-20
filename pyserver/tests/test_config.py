from __future__ import annotations

import base64
import json
import tempfile
import unittest
from pathlib import Path

from config import load_config


class ConfigTests(unittest.TestCase):
    def test_load_config_defaults(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "config.json"
            path.write_text(json.dumps({"hostname": "example.test"}), encoding="utf-8")
            cfg = load_config(path)
            self.assertEqual(cfg.hostname, "example.test")
            self.assertEqual(cfg.tool_name, "CodeGrinder")
            self.assertEqual(cfg.container_engine, "doas podman")
            self.assertEqual(len(cfg.sessions_expire), 2)

    def test_container_engine_override(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "config.json"
            path.write_text(
                json.dumps(
                    {
                        "hostname": "example.test",
                        "containerEngine": "doas podman",
                    }
                ),
                encoding="utf-8",
            )
            cfg = load_config(path)
            self.assertEqual(cfg.container_engine, "doas podman")

    def test_base64_secret_decode(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "config.json"
            secret = base64.b64encode(b"secret-value").decode("ascii")
            path.write_text(
                json.dumps(
                    {
                        "hostname": "example.test",
                        "sessionSecret": secret,
                        "daycareSecret": secret,
                    }
                ),
                encoding="utf-8",
            )
            cfg = load_config(path)
            self.assertEqual(cfg.session_secret, "secret-value")
            self.assertEqual(cfg.daycare_secret, "secret-value")

    def test_load_ip_filter(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "config.json"
            path.write_text(
                json.dumps(
                    {
                        "hostname": "example.test",
                        "ipFilter": {"whitelist": ["127.0.0.1", "10.0.0.0/8"]},
                    }
                ),
                encoding="utf-8",
            )
            cfg = load_config(path)
            self.assertIsNotNone(cfg.ip_filter)
            assert cfg.ip_filter is not None
            self.assertEqual(cfg.ip_filter.whitelist, ["127.0.0.1", "10.0.0.0/8"])


if __name__ == "__main__":
    unittest.main()
