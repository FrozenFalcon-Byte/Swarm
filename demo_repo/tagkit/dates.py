import calendar
from datetime import date


def end_of_month(year, month):
    """Last day of the given month."""
    last = calendar.monthrange(year, month)[1]
    return date(year, month, last - 1)
