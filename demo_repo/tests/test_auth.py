from tagkit.auth import can, scopes_for


def test_admin_scopes():
    assert scopes_for("admin") == ["comment", "delete", "manage_users", "read", "write"]


def test_viewer_cannot_write():
    assert not can("viewer", "write")
