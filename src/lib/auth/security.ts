/**
 * The account's signed-in devices, and two-step verification.
 *
 * Devices are read and ended through database functions over `auth.sessions`. Codes
 * are enrolled and checked by Supabase Auth, the same surface `changePassword` uses.
 * What this module's gate does is only the route to the code prompt: the database
 * (`public.enforce_mfa`) is what refuses a password-only token, so a client that
 * skips the prompt gets nothing.
 */

import { useEffect, useState } from "react";

import { ApiError } from "@/lib/api/client";
import { adoptSupabaseTokens, getAccessToken, useAuth } from "@/lib/auth/session";
import { publicConfig } from "@/lib/config";
import { t } from "@/lib/settings/language";
import { restGet, restMutate } from "@/lib/supabase/rest";

// ── Devices ─────────────────────────────────────────────────────────────────

export type DeviceSession = {
  id: string;
  createdAt: string;
  lastSeen: string;
  userAgent: string | null;
  ip: string | null;
  isCurrent: boolean;
};

type SessionRow = {
  id: string;
  created_at: string;
  last_seen: string;
  user_agent: string | null;
  ip: string | null;
  is_current: boolean;
};

function requireToken(): string {
  const token = getAccessToken();
  if (!token) throw new ApiError(t("Sign in to continue."), { code: "unauthorized", status: 401 });
  return token;
}

export async function listDeviceSessions(): Promise<DeviceSession[]> {
  const rows = await restGet<SessionRow[]>("rpc/list_my_sessions", requireToken());
  return rows.map((row) => ({
    id: row.id,
    createdAt: row.created_at,
    lastSeen: row.last_seen,
    userAgent: row.user_agent,
    ip: row.ip,
    isCurrent: row.is_current,
  }));
}

export async function endDeviceSession(id: string): Promise<void> {
  await restMutate("rpc/revoke_my_session", "POST", requireToken(), { p_session_id: id });
}

/** Signs out every other device, and answers how many that was. */
export async function endOtherDeviceSessions(): Promise<number> {
  const response = await restMutate("rpc/revoke_my_other_sessions", "POST", requireToken(), {});
  return (await response.json()) as number;
}

/** A readable name for a device, from its user agent. Unknown stays unknown. */
export function describeDevice(userAgent: string | null): string {
  if (!userAgent) return t("Unknown device");
  const browser = /Edg\//.test(userAgent)
    ? "Edge"
    : /OPR\//.test(userAgent)
      ? "Opera"
      : /Firefox\//.test(userAgent)
        ? "Firefox"
        : /Chrome\//.test(userAgent)
          ? "Chrome"
          : /Safari\//.test(userAgent)
            ? "Safari"
            : null;
  const system = /iPhone/.test(userAgent)
    ? "iPhone"
    : /iPad/.test(userAgent)
      ? "iPad"
      : /Android/.test(userAgent)
        ? "Android"
        : /Windows/.test(userAgent)
          ? "Windows"
          : /Mac OS X/.test(userAgent)
            ? "Mac"
            : /Linux/.test(userAgent)
              ? "Linux"
              : null;
  if (browser && system) return t("{browser} on {system}", { browser, system });
  return browser ?? system ?? t("Unknown device");
}

// ── Two-step verification ───────────────────────────────────────────────────

export type TwoFactorMethod = {
  id: string;
  name: string | null;
  verified: boolean;
  createdAt: string;
};

export type TwoFactorEnrollment = {
  id: string;
  /** An image of the QR code, as a data URL. */
  qrCode: string;
  /** The same secret as text, for an authenticator with no camera. */
  secret: string;
};

function authHeaders(token: string): Record<string, string> {
  return {
    apikey: publicConfig.supabase.publishableKey,
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

function authUrl(path: string): string {
  return `${publicConfig.supabase.url.replace(/\/+$/, "")}/auth/v1${path}`;
}

/** The assurance level a token carries, or null when it can't be read. */
export function tokenAssuranceLevel(token: string | undefined): string | null {
  const part = token?.split(".")[1];
  if (!part) return null;
  try {
    const claims = JSON.parse(atob(part.replace(/-/g, "+").replace(/_/g, "/"))) as {
      aal?: unknown;
    };
    return typeof claims.aal === "string" ? claims.aal : null;
  } catch {
    return null;
  }
}

export async function listTwoFactorMethods(): Promise<TwoFactorMethod[]> {
  const token = requireToken();
  const response = await fetch(authUrl("/user"), { headers: authHeaders(token) });
  if (!response.ok) {
    throw new ApiError(t("Couldn't read your two-step settings."), {
      code: "mfa_read_failed",
      status: response.status,
    });
  }
  const user = (await response.json()) as {
    factors?: Array<{
      id: string;
      status?: string;
      friendly_name?: string | null;
      factor_type?: string;
      created_at?: string;
    }>;
  };
  return (user.factors ?? [])
    .filter((factor) => factor.factor_type === "totp")
    .map((factor) => ({
      id: factor.id,
      name: factor.friendly_name ?? null,
      verified: factor.status === "verified",
      createdAt: factor.created_at ?? "",
    }));
}

export async function startTwoFactorEnrollment(name: string): Promise<TwoFactorEnrollment> {
  const token = requireToken();
  const response = await fetch(authUrl("/factors"), {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({ factor_type: "totp", friendly_name: name, issuer: "Unbored" }),
  });
  if (!response.ok) {
    throw new ApiError(t("Couldn't start two-step setup. Try again."), {
      code: "mfa_enroll_failed",
      status: response.status,
    });
  }
  const body = (await response.json()) as {
    id: string;
    totp: { qr_code: string; secret: string };
  };
  return { id: body.id, qrCode: body.totp.qr_code, secret: body.totp.secret };
}

/**
 * Checks a code against one method, which also finishes enrolling a new one. The
 * answer is a stronger session, so it replaces the current one.
 */
export async function verifyTwoFactorCode(factorId: string, code: string): Promise<void> {
  const token = requireToken();
  const challenge = await fetch(authUrl(`/factors/${factorId}/challenge`), {
    method: "POST",
    headers: authHeaders(token),
    body: "{}",
  });
  if (!challenge.ok) {
    throw new ApiError(t("Couldn't check that code. Try again."), {
      code: "mfa_challenge_failed",
      status: challenge.status,
    });
  }
  const { id } = (await challenge.json()) as { id: string };
  const verify = await fetch(authUrl(`/factors/${factorId}/verify`), {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({ challenge_id: id, code }),
  });
  if (!verify.ok) {
    throw new ApiError(t("That code didn't work. Check it and try again."), {
      code: "mfa_invalid_code",
      status: verify.status,
    });
  }
  const pair = (await verify.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in?: number;
  };
  await adoptSupabaseTokens({
    accessToken: pair.access_token,
    refreshToken: pair.refresh_token,
    expiresIn: pair.expires_in,
  });
}

export async function removeTwoFactorMethod(factorId: string): Promise<void> {
  const response = await fetch(authUrl(`/factors/${factorId}`), {
    method: "DELETE",
    headers: authHeaders(requireToken()),
  });
  if (!response.ok) {
    throw new ApiError(t("Couldn't remove this method. Try again."), {
      code: "mfa_remove_failed",
      status: response.status,
    });
  }
}

/**
 * Whether this session still owes a code. Only a password-level token can, so most
 * sessions never make the request. A failed read answers false: the server still
 * refuses the session, so nothing is unlocked by it.
 */
export function useTwoFactorRequired(): boolean {
  const auth = useAuth();
  const token = auth.status === "authenticated" ? getAccessToken() : undefined;
  const owes = tokenAssuranceLevel(token) === "aal1";
  const [required, setRequired] = useState(false);

  useEffect(() => {
    if (!owes) {
      setRequired(false);
      return;
    }
    let cancelled = false;
    listTwoFactorMethods()
      .then((methods) => {
        if (!cancelled) setRequired(methods.some((method) => method.verified));
      })
      .catch(() => {
        if (!cancelled) setRequired(false);
      });
    return () => {
      cancelled = true;
    };
  }, [owes, token]);

  return required;
}
