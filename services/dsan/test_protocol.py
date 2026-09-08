import base64
import errno
import unittest
from unittest.mock import Mock, patch

from app import (
    LOCAL_PORT,
    SERVER_BIND_HOST,
    SHARED,
    Handler,
    SharedState,
    base128_time,
    crc16_modbus,
    parse_limitimer_frame,
    public_config,
    validate_config,
    validate_message,
    verify_password,
    create_server,
)


CAPTURED_FRAME = bytes.fromhex(
    "8100217f0600010000045800007800000d0600000000000000000000060000000000000000000006000000000000000000000083e926ff"
)


class ProtocolTests(unittest.TestCase):
    def test_presenter_message_validation_and_blank_start(self):
        self.assertEqual(SharedState().data['message']['text'], '')
        message = validate_message({'text': ' Wrap up ', 'color': '#ffcc00', 'flash': True})
        self.assertEqual(message, {'text': 'Wrap up', 'color': '#ffcc00', 'flash': True})
        for payload in [{'text': 'x' * 161}, {'text': 'Hi', 'color': 'invalid'}, {'text': 123}]:
            with self.assertRaises(ValueError):
                validate_message(payload)

    def test_busy_port_falls_back_and_reports_actual_port(self):
        server = Mock(server_port=55001)
        with patch('app.ThreadingHTTPServer', side_effect=[OSError(errno.EADDRINUSE, 'busy'), server]) as factory, patch('app.LimitimerWorker') as timer, patch('app.PerfectCueWorker') as cue:
            try:
                self.assertIs(create_server(), server)
                self.assertEqual(factory.call_args_list[1].args[0], (SERVER_BIND_HOST, 0))
                self.assertEqual(SHARED.network_status()['server']['port'], 55001)
                timer.return_value.start.assert_called_once()
                cue.return_value.start.assert_called_once()
            finally:
                SHARED.server_port = LOCAL_PORT
                SHARED.network_cache_at = 0.0

    def test_failed_bind_does_not_start_device_workers(self):
        with patch('app.ThreadingHTTPServer', side_effect=PermissionError(errno.EACCES, 'denied')), patch('app.LimitimerWorker') as timer, patch('app.PerfectCueWorker') as cue:
            with self.assertRaises(PermissionError):
                create_server()
            timer.assert_not_called()
            cue.assert_not_called()

    def test_windows_busy_port_falls_back(self):
        error = OSError(10048, 'Only one usage of each socket address is normally permitted')
        error.winerror = 10048
        server = Mock(server_port=55002)
        with patch('app.ThreadingHTTPServer', side_effect=[error, server]) as factory, patch('app.LimitimerWorker'), patch('app.PerfectCueWorker'):
            try:
                self.assertIs(create_server(), server)
                self.assertEqual(factory.call_args_list[1].args[0], (SERVER_BIND_HOST, 0))
                self.assertEqual(SHARED.network_status()['server']['port'], 55002)
            finally:
                SHARED.server_port = LOCAL_PORT
                SHARED.network_cache_at = 0.0

    def test_local_application_port(self):
        self.assertEqual(LOCAL_PORT, 53971)
        self.assertEqual(SERVER_BIND_HOST, "0.0.0.0")

    def test_base128_time(self):
        self.assertEqual(base128_time(bytes.fromhex("000458"), 0), 600)
        self.assertEqual(base128_time(bytes.fromhex("000078"), 0), 120)

    def test_crc(self):
        self.assertEqual(crc16_modbus(CAPTURED_FRAME[:52]), 0xE926)

    def test_captured_limitimer_frame(self):
        parsed = parse_limitimer_frame(CAPTURED_FRAME)
        self.assertEqual(parsed["selected_program"], 1)
        self.assertTrue(parsed["countdown"])
        self.assertTrue(parsed["active"]["running"])
        self.assertEqual(parsed["active"]["total_seconds"], 600)
        self.assertEqual(parsed["active"]["sumup_seconds"], 120)
        self.assertEqual(parsed["active"]["elapsed_seconds"], 13)
        self.assertEqual(parsed["active"]["remaining"], "9:47")

    def test_perfectcue_event(self):
        state = SharedState()
        state.perfectcue_event(0x0F)
        cue = state.snapshot()["perfectcue"]
        self.assertEqual(cue["last_event"]["kind"], "next")
        self.assertEqual(cue["last_event"]["code"], "0x0F")
        self.assertEqual(cue["event_count"], 1)

    def test_bad_checksum_is_rejected(self):
        damaged = bytearray(CAPTURED_FRAME)
        damaged[16] += 1
        with self.assertRaisesRegex(ValueError, "checksum"):
            parse_limitimer_frame(bytes(damaged))

    def test_overtime_display_setting(self):
        config = validate_config(
            {
                "limitimer": {"host": "10.21.0.119", "port": 6120, "enabled": True},
                "perfectcue": {"host": "", "port": 6120, "enabled": False},
                "display": {"overtime": "stop"},
            }
        )
        self.assertEqual(config["display"]["overtime"], "stop")

    def test_display_preferences(self):
        config = validate_config(
            {
                "limitimer": {"host": "10.21.0.119", "port": 6120, "enabled": True},
                "perfectcue": {"host": "", "port": 6120, "enabled": False},
                "display": {"overtime": "continue", "font": "condensed", "show_lights": False},
            }
        )
        self.assertEqual(config["display"]["font"], "condensed")
        self.assertFalse(config["display"]["show_lights"])

    def test_remote_authentication_password_is_hashed(self):
        config = validate_config(
            {
                "limitimer": {"host": "10.21.0.119", "port": 6120, "enabled": True},
                "perfectcue": {"host": "", "port": 6120, "enabled": False},
                "access": {"require_auth": True, "username": "operator", "password": "correct-horse"},
            }
        )
        self.assertNotIn("password", config["access"])
        self.assertTrue(config["access"]["password_salt"])
        self.assertTrue(config["access"]["password_hash"])
        self.assertTrue(verify_password(config, "operator", "correct-horse"))
        self.assertFalse(verify_password(config, "operator", "wrong-password"))

    def test_public_config_hides_authentication_secrets(self):
        config = validate_config(
            {
                "limitimer": {"host": "10.21.0.119", "port": 6120, "enabled": True},
                "perfectcue": {"host": "", "port": 6120, "enabled": False},
                "access": {"require_auth": True, "username": "operator", "password": "correct-horse"},
            }
        )
        public = public_config(config)
        self.assertEqual(public["access"], {"require_auth": True, "username": "operator", "password_set": True})

    def test_blank_password_keeps_existing_password(self):
        original = validate_config(
            {
                "limitimer": {"host": "10.21.0.119", "port": 6120, "enabled": True},
                "perfectcue": {"host": "", "port": 6120, "enabled": False},
                "access": {"require_auth": True, "username": "operator", "password": "correct-horse"},
            }
        )
        updated = validate_config(
            {
                "limitimer": original["limitimer"],
                "perfectcue": original["perfectcue"],
                "display": original["display"],
                "access": {"require_auth": True, "username": "operator", "password": ""},
            },
            existing=original,
        )
        self.assertEqual(updated["access"]["password_hash"], original["access"]["password_hash"])
        self.assertTrue(verify_password(updated, "operator", "correct-horse"))

    def test_remote_requests_require_valid_basic_authentication(self):
        config = validate_config(
            {
                "limitimer": {"host": "10.21.0.119", "port": 6120, "enabled": True},
                "perfectcue": {"host": "", "port": 6120, "enabled": False},
                "access": {"require_auth": True, "username": "operator", "password": "correct-horse"},
            }
        )
        handler = object.__new__(Handler)
        handler.client_address = ("10.21.0.50", 50000)
        valid = base64.b64encode(b"operator:correct-horse").decode("ascii")
        with SHARED.lock:
            original = SHARED.config
            SHARED.config = config
        try:
            handler.headers = {}
            self.assertFalse(handler.authorized())
            handler.headers = {"Authorization": "Basic " + valid}
            self.assertTrue(handler.authorized())
            handler.headers = {"Authorization": "Basic not-valid-base64"}
            self.assertFalse(handler.authorized())
            handler.client_address = ("127.0.0.1", 50000)
            handler.headers = {}
            self.assertTrue(handler.authorized())
        finally:
            with SHARED.lock:
                SHARED.config = original


if __name__ == "__main__":
    unittest.main()
