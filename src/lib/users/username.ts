/**
 * Username rules and availability, shared by the sign-up screen.
 *
 * The rule mirrors `profiles_username_format` in the database (`^[a-z0-9_]{3,24}$`)
 * and the check in `services/auth`. Normalization is part of the rule: a value is
 * trimmed and lowercased before it is validated, stored or compared, which is why
 * `Rijad`, `rijad` and `RIJAD` are one username and the `citext` unique index can
 * enforce that case-insensitively.
 *
 * Availability is advisory. The server re-checks the name and the database's
 * unique index is the final authority: between this check and the sign-up insert
 * somebody else may claim the name, and that registration is refused rather than
 * renamed.
 */

import { useEffect, useState } from "react";

import { apiFetch } from "@/lib/api/client";

import { t } from "@/lib/settings/language";
export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 24;

/** How long typing settles before a lookup is made. */
export const USERNAME_CHECK_DEBOUNCE_MS = 400;

const USERNAME_PATTERN = /^[a-z0-9_]+$/;

/** The canonical form the API and database store. */
export function normalizeUsername(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * The first rule a value breaks, or `undefined` when it is valid. The value is
 * expected to be normalized already; `useUsernameAvailability` and the form do
 * that before calling it.
 */
export function usernameValidationMessage(value: string): string | undefined {
  if (value === "") return t("Choose a username.");
  const length = [...value].length;
  if (length < USERNAME_MIN_LENGTH || length > USERNAME_MAX_LENGTH) {
    return t("Use 3–24 characters for your username.");
  }
  if (!USERNAME_PATTERN.test(value)) {
    return t("Use only letters, numbers and underscores.");
  }
  return undefined;
}

/** The response of `GET /api/v1/auth/username-available`. */
export type UsernameAvailability = {
  username: string;
  available: boolean;
};

/**
 * Asks the API whether a username is unclaimed. Anonymous by design: the visitor
 * signing up has no account yet, and the endpoint answers with a boolean rather
 * than profile data.
 */
export function fetchUsernameAvailability(
  username: string,
  signal?: AbortSignal,
): Promise<UsernameAvailability> {
  return apiFetch<UsernameAvailability>("/auth/username-available", {
    query: { username },
    signal,
  });
}

/** What the sign-up form should tell the visitor about the name they typed. */
export type UsernameStatus =
  | { state: "empty" }
  | { state: "invalid"; message: string }
  | { state: "checking" }
  | { state: "available"; username: string }
  | { state: "taken" }
  | { state: "error" };

/** The message shown under the input for each state. */
export function usernameStatusMessage(status: UsernameStatus): string {
  switch (status.state) {
    case "empty":
      return t("Choose a username");
    case "invalid":
      return status.message;
    case "checking":
      return t("Checking availability...");
    case "available":
      return t("Username is available");
    case "taken":
      return t("Username is already taken");
    case "error":
      return t("Couldn't check username availability. Try again.");
  }
}

/**
 * Debounced, race-safe availability checking for a username being typed.
 *
 * `recheck` forces a fresh lookup for the current value (after a server refusal,
 * for instance) without changing what the visitor typed.
 *
 * Two guards keep a late answer from describing an older name:
 *   - the effect aborts its request when the value changes, and
 *   - a result is adopted only under the value it was requested for, so an
 *     in-flight response can never overwrite the status of the latest input even
 *     if the transport ignored the abort.
 * A failed request is reported as `error` — never as available.
 */
export function useUsernameAvailability(
  raw: string,
  recheck = 0,
): { status: UsernameStatus; recheck: () => void } {
  const username = normalizeUsername(raw);
  const invalid = usernameValidationMessage(username);
  // The answer is filed under the exact request that produced it: the value,
  // the caller's recheck counter and this hook's own. A recheck therefore
  // reports "checking" immediately instead of leaving the previous verdict on
  // screen while the new lookup runs.
  const requestKey = `${username}\u0000${recheck}\u0000`;
  const [checked, setChecked] = useState<{ key: string; status: UsernameStatus }>();
  const [nonce, setNonce] = useState(0);
  const activeKey = `${requestKey}${nonce}`;

  useEffect(() => {
    if (username === "" || invalid !== undefined) return;

    const controller = new AbortController();
    let active = true;

    const timer = setTimeout(() => {
      fetchUsernameAvailability(username, controller.signal).then(
        (result) => {
          if (!active || controller.signal.aborted) return;
          // The answer has to be about the name on screen. Comparing the
          // normalized value the server echoed is a second, independent guard
          // beside the abort: a proxy or a retry that ignores cancellation still
          // cannot apply an older answer.
          if (normalizeUsername(result.username) !== username) return;
          setChecked({
            key: activeKey,
            status: result.available ? { state: "available", username } : { state: "taken" },
          });
        },
        () => {
          if (!active || controller.signal.aborted) return;
          // A failed lookup is reported as unknown, never as available.
          setChecked({ key: activeKey, status: { state: "error" } });
        },
      );
    }, USERNAME_CHECK_DEBOUNCE_MS);

    return () => {
      active = false;
      controller.abort();
      clearTimeout(timer);
    };
  }, [username, invalid, activeKey, nonce, recheck]);

  function recheckNow(): void {
    setNonce((value) => value + 1);
  }

  // The effect runs after the render that changed the input, so a cached result
  // from the previous value must not be shown in the meantime.
  if (username === "") return { status: { state: "empty" }, recheck: recheckNow };
  if (invalid !== undefined)
    return { status: { state: "invalid", message: invalid }, recheck: recheckNow };
  if (checked?.key !== activeKey) return { status: { state: "checking" }, recheck: recheckNow };
  return { status: checked.status, recheck: recheckNow };
}
