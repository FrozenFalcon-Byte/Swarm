from tagkit.tags import join_tags, normalize_tags


def test_normalize_tags():
    assert normalize_tags([" UI", "bug", "api", "Bug", ""]) == ["api", "bug", "ui"]


def test_join_tags_single():
    assert join_tags(["Docs"]) == "docs"
