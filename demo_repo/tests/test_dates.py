from datetime import date

from tagkit.dates import end_of_month


def test_end_of_month_type():
    assert isinstance(end_of_month(2024, 2), date)
