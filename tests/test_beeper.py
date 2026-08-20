import unittest
from threading import Event

from specter.hardware.beeper import BeeperService


class FakeBuzzer:
    def __init__(self, pin):
        self.pin = pin
        self.played = []
        self.stopped = 0
        self.closed = False
        self.play_event = Event()

    def play(self, tone):
        self.played.append(tone)
        self.play_event.set()

    def stop(self):
        self.stopped += 1

    def close(self):
        self.closed = True


class BeeperServiceTests(unittest.TestCase):
    def test_unconfigured_beeper_reports_unavailable(self):
        beeper = BeeperService(pin=None)

        status = beeper.trigger("boot")

        self.assertFalse(status.configured)
        self.assertFalse(status.available)
        self.assertIn("not configured", status.last_error)

    def test_pattern_is_played_on_worker_and_gpio_is_closed(self):
        fake = FakeBuzzer(18)
        beeper = BeeperService(pin=18, buzzer_factory=lambda pin: fake, tone_factory=lambda frequency: frequency)

        status = beeper.trigger("acquired")
        self.assertTrue(status.available)
        self.assertTrue(fake.play_event.wait(timeout=1))
        beeper.stop()

        self.assertEqual(fake.pin, 18)
        self.assertIn(660, fake.played)
        self.assertGreater(fake.stopped, 0)
        self.assertTrue(fake.closed)

    def test_muted_beeper_does_not_queue_patterns(self):
        fake = FakeBuzzer(18)
        beeper = BeeperService(
            pin=18,
            muted=True,
            buzzer_factory=lambda pin: fake,
            tone_factory=lambda frequency: frequency,
        )

        status = beeper.trigger("warning")
        beeper.stop()

        self.assertTrue(status.muted)
        self.assertEqual(status.queued_patterns, 0)
        self.assertEqual(fake.played, [])

    def test_unknown_pattern_is_rejected(self):
        beeper = BeeperService(pin=None)

        status = beeper.trigger("not-a-pattern")

        self.assertIn("Unknown beeper pattern", status.last_error)


if __name__ == "__main__":
    unittest.main()
