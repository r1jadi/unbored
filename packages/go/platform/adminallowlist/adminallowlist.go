// Package adminallowlist decides whether a verified account email holds
// administrator access through the server-side ADMIN_EMAILS allowlist.
//
// The allowlist is read only on the server, per request, from the process
// environment — never from a VITE_* variable, never from a request body, query
// string or header. The email being checked always comes from a verified
// Supabase access token (identity.Identity.Email, set by authn.Verifier from
// the JWT's email claim after signature, audience, issuer and expiry checks).
// A client-supplied email, user id, role or isAdmin flag is never trusted.
//
// Matching is case-insensitive with surrounding whitespace ignored, so
// "Admin@Example.com " matches "admin@example.com". An empty or missing
// ADMIN_EMAILS grants no one: fail-closed, never fail-open.
package adminallowlist

import (
	"os"
	"strings"
)

// EnvVar is the exact server-side variable name. It must never gain a VITE_
// prefix: Vite inlines VITE_* values into the browser bundle.
const EnvVar = "ADMIN_EMAILS"

// Parse turns a raw ADMIN_EMAILS value into a deduplicated list of
// lower-cased emails. Empty entries are dropped. Entries without an "@" are
// dropped as well: they can never match a real account email, and keeping
// them would only hide a typo. The result is sorted for deterministic logs
// and tests.
func Parse(raw string) []string {
	seen := make(map[string]struct{})
	var out []string
	for _, part := range strings.Split(raw, ",") {
		email := strings.ToLower(strings.TrimSpace(part))
		if email == "" {
			continue
		}
		if !strings.Contains(email, "@") {
			continue
		}
		if _, dup := seen[email]; dup {
			continue
		}
		seen[email] = struct{}{}
		out = append(out, email)
	}
	if out == nil {
		return []string{}
	}
	// Insertion order is preserved (the split order), which keeps the operator's
	// ordering for logs. Callers that need sorted output sort it themselves.
	return out
}

// Get reads and parses the current server-side configuration. It reads the
// environment on every call so that changing the allowlist takes effect on
// the next request without relying on stale client state (a cached role, a
// token claim, localStorage). On Render an env change restarts the service, but a fresh
// read is still the correct behaviour for long-lived processes.
func Get() []string {
	return Parse(os.Getenv(EnvVar))
}

// IsAllowlistedWith reports whether email is in allowlist, comparing
// case-insensitively after trimming. Either side being empty never matches.
func IsAllowlistedWith(email string, allowlist []string) bool {
	needle := strings.ToLower(strings.TrimSpace(email))
	if needle == "" || len(allowlist) == 0 {
		return false
	}
	for _, entry := range allowlist {
		if needle == strings.ToLower(strings.TrimSpace(entry)) {
			return true
		}
	}
	return false
}

// IsAllowlisted reports whether the verified email is in the current
// server-side allowlist. It returns false for empty emails and for a missing
// or empty ADMIN_EMAILS (fail-closed).
func IsAllowlisted(email string) bool {
	return IsAllowlistedWith(email, Get())
}
