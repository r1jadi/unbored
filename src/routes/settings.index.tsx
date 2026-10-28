import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ChevronRight, LogOut, Shield, Trash2 } from "lucide-react";
import { useState } from "react";
import { Avatar, Page, PageHeader } from "@/components/common";
import { settingsGroups } from "@/components/settings/config";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";
import { useAdminVisibility } from "@/lib/admin/visibility";
import { ApiError } from "@/lib/api/client";
import { signOut, useAuth } from "@/lib/auth/session";
import { seo } from "@/lib/seo";
import { deleteAccount } from "@/lib/users/account";
import { avatarUrl, clearProfile, useProfile, type ProfileState } from "@/lib/users/profile";

export const Route = createFileRoute("/settings/")({
  head: () => seo("Settings", "Manage your Unbored account, privacy and preferences."),
  component: Settings,
});

/**
 * The account row: the real identity from `services/users`, or an honest account
 * of why it cannot be shown. It never falls back to a placeholder name.
 */
function Identity({ state }: { state: ProfileState }) {
  if (state.status === "ready") {
    const { profile } = state;
    return (
      <>
        <Avatar name={profile.username} src={avatarUrl(profile)} size="lg" />
        <div className="flex-1">
          <p className="font-medium">{profile.displayName}</p>
          <p className="text-sm text-muted-foreground">@{profile.username}</p>
        </div>
      </>
    );
  }
  if (state.status === "idle" || state.status === "loading") {
    return (
      <>
        <Skeleton className="size-14 rounded-full" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-3 w-24" />
        </div>
      </>
    );
  }
  if (state.status === "error") {
    // The row links to the profile screen, which is where the retry lives.
    return (
      <>
        <Avatar name="" size="lg" />
        <div className="flex-1">
          <p className="font-medium">Couldn't load your profile</p>
          <p className="text-sm text-muted-foreground">Open to try again</p>
        </div>
      </>
    );
  }
  return (
    <>
      <Avatar name="" size="lg" />
      <div className="flex-1">
        <p className="font-medium">
          {state.status === "anonymous" ? "Sign in to view your profile" : "No profile yet"}
        </p>
        <p className="text-sm text-muted-foreground">
          {state.status === "anonymous"
            ? "Your identity comes from your account"
            : "Open to try again"}
        </p>
      </div>
    </>
  );
}

function Settings() {
  const nav = useNavigate();
  const auth = useAuth();
  const profile = useProfile();
  const showAdmin = useAdminVisibility();
  const [logout, setLogout] = useState(false);
  const [del, setDel] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string>();
  const signedIn = auth.status === "authenticated";

  return (
    <Page>
      <PageHeader back title="Settings" />
      {signedIn ? (
        <Link
          to="/profile"
          className="press mx-4 flex items-center gap-3 rounded-xl bg-surface p-3 md:mx-0"
        >
          <Identity state={profile} />
          <ChevronRight className="size-4 text-muted-foreground" />
        </Link>
      ) : (
        <Link
          to="/login"
          className="press mx-4 flex items-center gap-3 rounded-xl bg-surface p-3 md:mx-0"
        >
          <Identity state={profile} />
          <ChevronRight className="size-4 text-muted-foreground" />
        </Link>
      )}
      {settingsGroups.map((g) => (
        <section key={g.label} className="mt-6">
          <h2 className="px-4 pb-2 text-xs font-medium text-muted-foreground md:px-0">{g.label}</h2>
          <ul className="mx-4 divide-y divide-border overflow-hidden rounded-xl bg-surface md:mx-0">
            {g.items.map(({ slug, title, desc, icon: Icon }) => (
              <li key={slug}>
                <Link
                  to="/settings/$section"
                  params={{ section: slug }}
                  className="flex min-h-14 items-center gap-3 px-4 hover:bg-surface-2"
                >
                  <Icon className="size-[18px] text-muted-foreground" strokeWidth={1.75} />
                  <span className="flex-1 text-sm">{title}</span>
                  {desc && (
                    <span className="hidden text-sm text-muted-foreground sm:block">{desc}</span>
                  )}
                  <ChevronRight className="size-4 text-muted-foreground" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {showAdmin && (
        <section className="mt-6">
          <h2 className="px-4 pb-2 text-xs font-medium text-muted-foreground md:px-0">Admin</h2>
          <ul className="mx-4 divide-y divide-border overflow-hidden rounded-xl bg-surface md:mx-0">
            <li>
              <Link
                to="/admin"
                className="flex min-h-14 items-center gap-3 px-4 hover:bg-surface-2"
              >
                <Shield className="size-[18px] text-muted-foreground" strokeWidth={1.75} />
                <span className="flex-1 text-sm">Admin dashboard</span>
                <span className="hidden text-sm text-muted-foreground sm:block">
                  Moderation, games, analytics
                </span>
                <ChevronRight className="size-4 text-muted-foreground" />
              </Link>
            </li>
          </ul>
        </section>
      )}
      {signedIn ? (
        <ul className="mx-4 mt-6 divide-y divide-border overflow-hidden rounded-xl bg-surface md:mx-0">
          <li>
            <button
              onClick={() => setLogout(true)}
              className="flex min-h-14 w-full items-center gap-3 px-4 text-sm hover:bg-surface-2"
            >
              <LogOut className="size-[18px] text-muted-foreground" strokeWidth={1.75} />
              Log out
            </button>
          </li>
          <li>
            <button
              onClick={() => setDel(true)}
              className="flex min-h-14 w-full items-center gap-3 px-4 text-sm text-destructive hover:bg-surface-2"
            >
              <Trash2 className="size-[18px]" strokeWidth={1.75} />
              Delete account
            </button>
          </li>
        </ul>
      ) : (
        <div className="mx-4 mt-6 rounded-xl bg-surface p-4 md:mx-0">
          <p className="text-sm font-medium">Signed out</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Log in to manage your account, or browse the public catalogue as a guest.
          </p>
          <Button asChild className="mt-3">
            <Link to="/login" search={{ redirect: "/settings" }}>
              Log in
            </Link>
          </Button>
        </div>
      )}

      <AlertDialog open={logout} onOpenChange={setLogout}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Log out of Unbored?</AlertDialogTitle>
            <AlertDialogDescription>Your scores are saved to your account.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                // The local session is cleared before the revoke is sent, so a
                // failed call cannot leave the user inside a signed-in shell.
                try {
                  await signOut();
                } catch {
                  // Nothing left to do here: the session is already gone locally
                  // and the access token stops being accepted when it expires.
                }
                clearProfile();
                nav({ to: "/welcome" });
              }}
            >
              Log out
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog
        open={del}
        onOpenChange={(open) => {
          if (deleting) return;
          setDel(open);
          setConfirmText("");
          setDeleteError(undefined);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete your account?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes your account and everything in it: your profile and picture,
              scores and leaderboard places, comments, likes, saved games, follows and saved runs.
              It can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <label className="block space-y-1.5" htmlFor="delete-confirm">
            <span className="text-sm">
              Type <span className="font-semibold">DELETE</span> to confirm
            </span>
            <input
              id="delete-confirm"
              value={confirmText}
              onChange={(event) => setConfirmText(event.target.value)}
              autoComplete="off"
              autoCapitalize="characters"
              disabled={deleting}
              className="h-11 w-full rounded-lg bg-surface px-3 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring md:text-sm"
            />
          </label>
          {deleteError && (
            <p className="text-sm text-destructive" role="alert">
              {deleteError}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <Button
              variant="destructive"
              disabled={deleting || confirmText.trim() !== "DELETE"}
              onClick={async () => {
                setDeleting(true);
                setDeleteError(undefined);
                try {
                  await deleteAccount();
                  setDel(false);
                  toast.success("Your account has been deleted.");
                  nav({ to: "/welcome" });
                } catch (error) {
                  setDeleteError(
                    error instanceof ApiError
                      ? error.message
                      : "Couldn't delete your account. Try again.",
                  );
                } finally {
                  setDeleting(false);
                }
              }}
            >
              {deleting ? "Deleting…" : "Delete account"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Page>
  );
}
