from __future__ import annotations

import unittest

from ipfilter import IPFilter, extract_ip_from_peer


class IPFilterTests(unittest.TestCase):
    def test_disabled_allows_all(self) -> None:
        filt = IPFilter.from_entries([])
        self.assertTrue(filt.allows_ip("203.0.113.9"))

    def test_cidr_and_wildcard(self) -> None:
        filt = IPFilter.from_entries(["10.0.0.0/8", "192.168.1.*"])
        self.assertTrue(filt.allows_ip("10.2.3.4"))
        self.assertTrue(filt.allows_ip("192.168.1.20"))
        self.assertFalse(filt.allows_ip("192.168.2.20"))

    def test_extract_peer(self) -> None:
        self.assertEqual(extract_ip_from_peer("ipv4:127.0.0.1:50000"), "127.0.0.1")
        self.assertEqual(extract_ip_from_peer("ipv6:[::1]:50000"), "::1")


if __name__ == "__main__":
    unittest.main()

