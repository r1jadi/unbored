import { useEffect, useState } from "react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { disablePush, enablePush, readPushStatus, type PushStatus } from "@/lib/notifications/push";
import { t } from "@/lib/settings/language";

/** Why the switch can't be used, or what it does when it can. */
function describe(status: PushStatus | undefined): string {
  switch (status) {
    case "needs-install":
      return t(
        "On iPhone and iPad, add Unbored to your Home Screen first, then open it from there.",
      );
    case "unsupported":
      return t("This browser doesn't support push notifications.");
    case "unconfigured":
      return t("Push notifications aren't available right now.");
    case "denied":
      return t(
        "Blocked for this site. Allow notifications in your browser's settings to turn this on.",
      );
    default:
      return t("Get what you've chosen above on this device, even when Unbored is closed.");
  }
}

/**
 * The per-device push switch. Which notifications are sent is the account's choice,
 * in the toggles above it; this says whether they come to this device.
 */
export function PushToggle() {
  const [status, setStatus] = useState<PushStatus>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    readPushStatus()
      .then((next) => {
        if (!cancelled) setStatus(next);
      })
      .catch(() => {
        if (!cancelled) setStatus("unsupported");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function change(next: boolean) {
    setBusy(true);
    setError(undefined);
    try {
      setStatus(await (next ? enablePush() : disablePush()));
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t("Couldn't turn on push notifications. Try again."),
      );
    } finally {
      setBusy(false);
    }
  }

  const usable = status === "on" || status === "off";
  return (
    <>
      <div className="flex min-h-14 items-center gap-3 px-4 py-3">
        <Label htmlFor="push" className="flex-1 font-normal">
          <span className="block text-sm">{t("Push notifications")}</span>
          <span className="text-xs text-muted-foreground">{describe(status)}</span>
        </Label>
        <Switch
          id="push"
          checked={status === "on"}
          onCheckedChange={(next) => void change(next)}
          disabled={!usable || busy}
        />
      </div>
      {error && (
        <p className="px-4 pb-3 text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
