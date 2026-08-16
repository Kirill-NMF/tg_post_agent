import sys
from types import SimpleNamespace
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import failed_decoration_delivery as delivery

class DeliveryContractTests(unittest.TestCase):
    def test_identity_preflight_requires_all_four_invariants(self):
        self.assertTrue(delivery.identity_preflight(True, True, True, True))
        for index in range(4):
            values = [True, True, True, True]
            values[index] = False
            self.assertFalse(delivery.identity_preflight(*values))

    def test_txt_artifact_must_be_nonempty(self):
        self.assertTrue(delivery.document_is_nonempty(SimpleNamespace(document=SimpleNamespace(size=1))))
        self.assertFalse(delivery.document_is_nonempty(SimpleNamespace(document=SimpleNamespace(size=0))))
        self.assertFalse(delivery.document_is_nonempty(SimpleNamespace()))

    def test_exact_successful_notified_version_is_ready(self):
        self.assertTrue(delivery.isolated_runner_ready({
            "processed": True,
            "jobSucceeded": True,
            "finalState": True,
            "formattedNonempty": True,
            "draftVersionMatched": True,
            "notificationSent": True,
            "lexicalPreserved": True,
            "permittedEmojiCount": 1,
            "decorationPresent": True,
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
            "lexicalPreserved": True,
            "permittedEmojiCount": 1,
            "decorationPresent": True,
            "providerAttempted": True,
            "preflightMaxProviderAttempts": 1,
        }
        self.assertFalse(delivery.isolated_runner_ready({**base, "notificationSent": False}))
        self.assertFalse(delivery.isolated_runner_ready({**base, "draftVersionMatched": False}))
        self.assertFalse(delivery.isolated_runner_ready({**base, "lexicalPreserved": False}))
        self.assertFalse(delivery.isolated_runner_ready({**base, "permittedEmojiCount": 0}))

    def test_attempt_bound_must_be_exactly_one(self):
        self.assertFalse(delivery.isolated_runner_ready({
            "processed": True,
            "jobSucceeded": True,
            "finalState": True,
            "formattedNonempty": True,
            "draftVersionMatched": True,
            "notificationSent": True,
            "lexicalPreserved": True,
            "permittedEmojiCount": 1,
            "decorationPresent": True,
            "providerAttempted": True,
            "preflightMaxProviderAttempts": 2,
        }))

if __name__ == "__main__":
    unittest.main()
