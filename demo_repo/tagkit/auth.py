ROLE_SCOPES = {
    "viewer": ["read"],
    "editor": ["read", "write", "comment"],
    "admin": ["read", "write", "comment", "delete", "manage_users"],
}


def scopes_for(role, extra=()):
    """All scopes a role grants, plus any extra scopes, without duplicates."""
    return list(set(ROLE_SCOPES.get(role, [])) | set(extra))


def can(role, scope):
    return scope in scopes_for(role)
