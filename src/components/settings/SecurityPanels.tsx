import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Laptop, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api/client";
import {
  describeDevice,
  endDeviceSession,
  endOtherDeviceSessions,
  listDeviceSessions,
  listTwoFactorMethods,
  removeTwoFactorMethod,
  startTwoFactorEnrollment,
  verifyTwoFactorCode,
  type DeviceSession,
  type TwoFactorEnrollment,
  type TwoFactorMethod,
} from "@/lib/auth/security";
import { t } from "@/lib/settings/language";

function messageOf(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

function when(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/** Every device signed in to this account, and the way to end each one. */
export function DeviceSessionsPanel() {
  const [devices, setDevices] = useState<DeviceSession[] | null>(null);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    listDeviceSessions()
      .then((rows) => {
        setDevices(rows);
        setError(undefined);
      })
      .catch(() => setError(t("Couldn't load your devices.")));
  }, []);

  useEffect(load, [load]);

  async function end(id: string) {
    setBusy(true);
    try {
      await endDeviceSession(id);
      toast.success(t("That device is signed out."));
      load();
    } catch {
      toast.error(t("Couldn't sign that device out. Try again."));
    } finally {
      setBusy(false);
    }
  }

  async function endOthers() {
    setBusy(true);
    try {
      await endOtherDeviceSessions();
      toast.success(t("Your other devices are signed out."));
      load();
    } catch {
      toast.error(t("Couldn't sign out your other devices. Try again."));
    } finally {
      setBusy(false);
    }
  }

  const others = devices?.filter((device) => !device.isCurrent) ?? [];

  return (
    <div className="px-4 py-3">
      {error ? (
        <div className="flex items-center justify-between gap-3 text-sm">
          <span className="text-muted-foreground">{error}</span>
          <Button size="sm" variant="ghost" onClick={load}>
            {t("Retry")}
          </Button>
        </div>
      ) : devices === null ? (
        <p className="text-sm text-muted-foreground">{t("Loading…")}</p>
      ) : (
        <>
          <ul className="space-y-3">
            {devices.map((device) => (
              <li key={device.id} className="flex items-center gap-3">
                <Laptop className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">
                    {describeDevice(device.userAgent)}
                    {device.isCurrent && (
                      <span className="ml-2 text-xs font-medium text-primary">
                        {t("This device")}
                      </span>
                    )}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {t("Last active {when}", { when: when(device.lastSeen) })}
                    {device.ip ? ` · ${device.ip}` : ""}
                  </p>
                </div>
                {!device.isCurrent && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => void end(device.id)}
                  >
                    {t("Sign out")}
                  </Button>
                )}
              </li>
            ))}
          </ul>
          {others.length > 0 && (
            <Button
              size="sm"
              variant="secondary"
              className="mt-3"
              disabled={busy}
              onClick={() => void endOthers()}
            >
              {t("Sign out of all other devices")}
            </Button>
          )}
          <p className="mt-3 text-xs text-muted-foreground">
            {t("A signed-out device can take up to an hour to lose access completely.")}
          </p>
        </>
      )}
    </div>
  );
}

/** Authenticator-app codes: turning them on, and off again. */
export function TwoFactorPanel() {
  const [methods, setMethods] = useState<TwoFactorMethod[] | null>(null);
  const [enrollment, setEnrollment] = useState<TwoFactorEnrollment | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    listTwoFactorMethods()
      .then(async (rows) => {
        // An abandoned setup can't be used and would block starting another.
        const abandoned = rows.filter((method) => !method.verified);
        await Promise.all(
          abandoned.map((method) => removeTwoFactorMethod(method.id).catch(() => undefined)),
        );
        setMethods(rows.filter((method) => method.verified));
        setError(undefined);
      })
      .catch(() => setError(t("Couldn't read your two-step settings.")));
  }, []);

  useEffect(load, [load]);

  async function start() {
    setBusy(true);
    setError(undefined);
    try {
      const count = methods?.length ?? 0;
      setEnrollment(
        await startTwoFactorEnrollment(
          count === 0 ? "Authenticator" : `Authenticator ${count + 1}`,
        ),
      );
    } catch (err) {
      setError(messageOf(err, t("Couldn't start two-step setup. Try again.")));
    } finally {
      setBusy(false);
    }
  }

  async function confirm(event: FormEvent) {
    event.preventDefault();
    if (!enrollment || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await verifyTwoFactorCode(enrollment.id, code.trim());
      setEnrollment(null);
      setCode("");
      toast.success(t("Two-step verification is on."));
      load();
    } catch (err) {
      setError(messageOf(err, t("That code didn't work. Check it and try again.")));
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    if (enrollment) await removeTwoFactorMethod(enrollment.id).catch(() => undefined);
    setEnrollment(null);
    setCode("");
    setError(undefined);
  }

  async function remove(id: string) {
    setBusy(true);
    try {
      await removeTwoFactorMethod(id);
      toast.success(t("Removed."));
      load();
    } catch (err) {
      toast.error(messageOf(err, t("Couldn't remove this method. Try again.")));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 px-4 py-3">
      {methods === null && !error && (
        <p className="text-sm text-muted-foreground">{t("Loading…")}</p>
      )}
      {methods && methods.length > 0 && (
        <ul className="space-y-2">
          {methods.map((method) => (
            <li key={method.id} className="flex items-center gap-3">
              <ShieldCheck className="size-4 shrink-0 text-success" aria-hidden />
              <span className="min-w-0 flex-1 truncate text-sm">
                {method.name ?? t("Authenticator app")}
              </span>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => void remove(method.id)}
              >
                {t("Remove")}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {methods && !enrollment && (
        <>
          <p className="text-sm text-muted-foreground">
            {methods.length === 0
              ? t(
                  "Ask for a code from an authenticator app when you log in, as well as your password.",
                )
              : t(
                  "There are no backup codes, so add a second authenticator in case you lose your phone.",
                )}
          </p>
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => void start()}>
            {methods.length === 0
              ? t("Turn on two-step verification")
              : t("Add another authenticator")}
          </Button>
        </>
      )}
      {enrollment && (
        <form className="space-y-3" onSubmit={(e) => void confirm(e)}>
          <p className="text-sm">{t("Scan this with your authenticator app:")}</p>
          <img
            src={enrollment.qrCode}
            alt={t("QR code for your authenticator app")}
            className="size-44 rounded-lg bg-white p-2"
          />
          <p className="text-xs text-muted-foreground">
            {t("Or enter this key by hand:")}{" "}
            <code className="break-all font-mono">{enrollment.secret}</code>
          </p>
          <label className="block space-y-1.5" htmlFor="mfa-setup-code">
            <span className="text-sm">{t("6-digit code")}</span>
            <input
              id="mfa-setup-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              className="h-11 w-full rounded-lg bg-surface-2 px-3 text-sm tracking-widest outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </label>
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={busy || code.length !== 6}>
              {t("Confirm")}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => void cancel()}>
              {t("Cancel")}
            </Button>
          </div>
        </form>
      )}
      {error && (
        <p role="status" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
