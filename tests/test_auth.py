import unittest

from core.auth import IdentityError, issue_hmac_access_token, resolve_request_identity


class IdentityTests(unittest.TestCase):
    def test_local_sandbox_resolves_header_user(self):
        identity = resolve_request_identity(
            {"X-PixelDoodle-User-Id": "user-123"},
            environ={"PIXELDOODLE_ENV": "development"},
        )

        self.assertEqual(identity.user_id, "user-123")
        self.assertEqual(identity.auth_mode, "sandbox")

    def test_sandbox_is_fail_closed_in_production(self):
        for environment in ("production", " PrOd "):
            with self.subTest(environment=environment):
                with self.assertRaisesRegex(IdentityError, "disabled"):
                    resolve_request_identity(
                        {"X-PixelDoodle-User-Id": "user-123"},
                        environ={
                            "PIXELDOODLE_ENV": environment,
                            "PIXELDOODLE_AUTH_MODE": "sandbox",
                            "PIXELDOODLE_ENABLE_SANDBOX": "true",
                        },
                    )

    def test_hmac_bearer_round_trip_and_expiry(self):
        secret = "s" * 32
        token = issue_hmac_access_token(
            "merchant@example.com", secret, ttl_seconds=60, now=100
        )
        identity = resolve_request_identity(
            {"Authorization": f"Bearer {token}"},
            environ={
                "PIXELDOODLE_ENV": "production",
                "PIXELDOODLE_AUTH_SECRET": secret,
            },
            now=159,
        )
        self.assertEqual(identity.user_id, "merchant@example.com")

        with self.assertRaisesRegex(IdentityError, "expired"):
            resolve_request_identity(
                {"Authorization": f"Bearer {token}"},
                environ={
                    "PIXELDOODLE_ENV": "production",
                    "PIXELDOODLE_AUTH_SECRET": secret,
                },
                now=160,
            )

    def test_hmac_bearer_rejects_tampering(self):
        secret = "s" * 32
        token = issue_hmac_access_token("user-123", secret, now=100)
        tampered = token[:-1] + ("A" if token[-1] != "A" else "B")

        with self.assertRaisesRegex(IdentityError, "Invalid"):
            resolve_request_identity(
                {"Authorization": f"Bearer {tampered}"},
                environ={
                    "PIXELDOODLE_AUTH_SECRET": secret,
                    "PIXELDOODLE_ENV": "production",
                },
                now=101,
            )


if __name__ == "__main__":
    unittest.main()
