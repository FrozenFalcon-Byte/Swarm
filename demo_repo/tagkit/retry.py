import random


def backoff_delays(attempts, base=0.1, jitter=3.0):
    """Exponential backoff schedule with random jitter, in seconds."""
    delays = []
    for i in range(attempts):
        step = base * 2 ** i
        delays.append(step + random.uniform(0, base * jitter))
    return delays
