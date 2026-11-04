import { Search } from "lucide-react";
import { useEffect, useState } from "react";
import { UserAvatar } from "@/components/common";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { getSessionUserId } from "@/lib/auth/session";
import { t } from "@/lib/settings/language";
import { searchProfiles, type PublicProfile } from "@/lib/social/follows";

/**
 * Finds a player to write to. Whether they accept messages is not decided here: only
 * trying to send can say so, and the answer doesn't tell a block from a setting.
 */
export function PlayerPicker({
  open,
  onOpenChange,
  title,
  onPick,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  onPick: (profile: PublicProfile) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PublicProfile[]>();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const q = query.trim();
    setFailed(false);
    if (q === "") {
      setResults(undefined);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      searchProfiles(q, 10)
        .then((rows) => {
          if (!cancelled) setResults(rows.filter((row) => row.id !== getSessionUserId()));
        })
        .catch(() => {
          if (!cancelled) setFailed(true);
        });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query]);

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md gap-3">
        <DialogTitle>{title}</DialogTitle>
        <div className="relative">
          <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("Search players")}
            aria-label={t("Search players")}
            className="pl-9"
          />
        </div>
        <div className="max-h-72 min-h-16 overflow-y-auto" aria-live="polite">
          {failed && (
            <p className="py-4 text-center text-sm text-destructive">
              {t("Couldn't search right now. Try again.")}
            </p>
          )}
          {!failed && results?.length === 0 && (
            <p className="py-4 text-center text-sm text-muted-foreground">
              {t("No players found.")}
            </p>
          )}
          {!failed && (
            <ul>
              {results?.map((profile) => (
                <li key={profile.id}>
                  <button
                    type="button"
                    onClick={() => onPick(profile)}
                    className="press flex w-full items-center gap-3 rounded-lg p-2 text-left hover:bg-surface"
                  >
                    <UserAvatar username={profile.username} path={profile.avatar_path} size="sm" />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">
                        {profile.display_name}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        @{profile.username}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
