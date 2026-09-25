def normalize_tags(tags):
    """Lower-case, strip and de-duplicate tags."""
    cleaned = [t.strip().lower() for t in tags if t and t.strip()]
    return list(set(cleaned))


def join_tags(tags, sep=","):
    return sep.join(normalize_tags(tags))
