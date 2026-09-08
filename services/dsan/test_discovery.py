import unittest
from unittest.mock import MagicMock, patch
from discovery import scan_network, scan_targets, identify_traffic, listen_for_identity


class DiscoveryTests(unittest.TestCase):
    def test_protocol_identification_and_fragmented_frames(self):
        from test_protocol import CAPTURED_FRAME
        self.assertTrue(identify_traffic(CAPTURED_FRAME).startswith('Limitimer'))
        bad = bytearray(CAPTURED_FRAME)
        bad[52] ^= 1
        self.assertTrue(identify_traffic(bad).startswith('Unknown'))
        self.assertTrue(identify_traffic(b'').startswith('Unknown'))
        self.assertTrue(identify_traffic(b'\x0f').startswith('Possible PerfectCue'))
        connection = MagicMock()
        connection.recv.side_effect = [CAPTURED_FRAME[:20], CAPTURED_FRAME[20:]]
        self.assertTrue(listen_for_identity(connection).startswith('Limitimer'))
    def test_bounds_and_ports(self):
        self.assertEqual(scan_targets({'subnet':'10.21.0.119/32', 'ports':[6120]}), [('10.21.0.119', 6120)])
        for subnet in ['10.0.0.0/8', '8.8.8.8/32', '::1/128', 'invalid']:
            with self.assertRaises(ValueError):
                scan_targets({'subnet':subnet, 'ports':[6120]})
        with self.assertRaises(ValueError):
            scan_targets({'subnet':'10.0.0.1/32', 'ports':[0]})

    def test_multiple_results_and_existing_connection_not_probed(self):
        with patch('discovery.socket.create_connection', return_value=MagicMock()) as connect, patch('discovery.listen_for_identity', return_value='Unknown'):
            results = scan_network({'subnet':'10.21.0.0/30', 'ports':[6120]}, [('10.21.0.1', 6120)])
        self.assertEqual([item['host'] for item in results], ['10.21.0.1', '10.21.0.2'])
        connect.assert_called_once_with(('10.21.0.2', 6120), timeout=0.4)

    def test_closed_port_is_not_reported(self):
        with patch('discovery.socket.create_connection', side_effect=OSError):
            self.assertEqual(scan_network({'subnet':'10.21.0.1/32', 'ports':[6120]}), [])


if __name__ == '__main__':
    unittest.main()
