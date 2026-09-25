from tagkit.retry import backoff_delays


def test_backoff_length():
    assert len(backoff_delays(5)) == 5


def test_backoff_is_increasing():
    delays = backoff_delays(4)
    assert all(a < b for a, b in zip(delays, delays[1:]))
