import { Bell, Share, Smartphone } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { useInstallAsk } from "@/lib/engagement/ask";
import { t } from "@/lib/settings/language";

/**
 * The home-screen and push ask, on a result screen once a player has finished
 * three games (`useInstallAsk` decides). Each offer goes away once it is done;
 * "Not now" puts both away.
 */
export function InstallAsk() {
  const ask = useInstallAsk();
  const [showSteps, setShowSteps] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!ask) return null;

  async function turnOnPush() {
    if (!ask) return;
    setBusy(true);
    try {
      const status = await ask.turnOnPush();
      if (status === "on") toast.success(t("Notifications are on."));
      else if (status === "denied")
        toast.error(t("Notifications are blocked for Unbored in your browser settings."));
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("Couldn't turn on push notifications."),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className="mt-2 rounded-xl bg-surface p-3 text-left"
      aria-label={t("Keep Unbored close")}
    >
      <p className="text-sm font-medium">{t("Keep Unbored close")}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">
        {ask.canPush
          ? t("Open it in one tap, and hear when a friend beats your score.")
          : t("Open it in one tap, like any other app.")}
      </p>

      {showSteps && (
        <p className="mt-2 flex items-start gap-2 rounded-lg bg-surface-2 p-2 text-xs">
          <Share className="mt-0.5 size-3.5 shrink-0" />
          {t("Tap Share in Safari's toolbar, then Add to Home Screen.")}
        </p>
      )}

      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        {ask.canInstall && (
          <Button variant="secondary" size="sm" onClick={() => void ask.install()}>
            <Smartphone />
            {t("Add to Home Screen")}
          </Button>
        )}
        {ask.installSteps && !showSteps && (
          <Button variant="secondary" size="sm" onClick={() => setShowSteps(true)}>
            <Smartphone />
            {t("Add to Home Screen")}
          </Button>
        )}
        {ask.canPush && (
          <Button variant="secondary" size="sm" disabled={busy} onClick={() => void turnOnPush()}>
            <Bell />
            {t("Turn on notifications")}
          </Button>
        )}
        <Button
          variant="link"
          size="sm"
          className="px-1 text-muted-foreground"
          onClick={ask.dismiss}
        >
          {t("Not now")}
        </Button>
      </div>
    </section>
  );
}
