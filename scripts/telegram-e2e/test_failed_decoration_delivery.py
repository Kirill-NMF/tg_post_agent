import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import failed_decoration_delivery as delivery

class DeliveryContractTests(unittest.TestCase):
    def test_exact_successful_notified_version_is_ready(self):
        self.assertTrue(delivery.isolated_runner_ready({
            "processed": True,
            "jobSucceeded": True,
            "finalState": True,
            "formattedNonempty": True,
            "draftVersionMatched": True,
            "notificationSent": True,
            "providerAttempted": True,
            "preflightMaxProviderAttempts": 1,
        }))

    def test_missing_notification_or_version_refuses_before_done(self):
        base = {
            "processed": True,
            "jobSucceeded": True,
            "finalState": True,
            "formattedNonempty": True,
            "draftVersionMatched": True,
            "notificationSent": True,
            "providerAttempted": True,
            "preflightMaxProviderAttempts": 1,
        }
        self.assertFalse(delivery.isolated_runner_ready({**base, "notificationSent": False}))
        self.assertFalse(delivery.isolated_runner_ready({**base, "draftVersionMatched": False}))

    def test_attempt_bound_must_be_exactly_one(self):
        self.assertFalse(delivery.isolated_runner_ready({
            "processed": True,
            "jobSucceeded": True,
            "finalState": True,
            "formattedNonempty": True,
            "draftVersionMatched": True,
            "notificationSent": True,
            "providerAttempted": True,
            "preflightMaxProviderAttempts": 2,
        }))

if __name__ == "__main__":
    unittest.main()
