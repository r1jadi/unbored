import { Link, useNavigate } from "@tanstack/react-router";
import { useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { toast } from "sonner";
import { Field } from "@/components/auth/AuthLayout";
import { Avatar, EmptyState, ErrorState } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { ApiError } from "@/lib/api/client";
import {
  avatarUrl,
  changeAvatar,
  fieldError,
  profileErrorMessage,
  refreshProfile,
  updateProfile,
  useProfile,
  type Profile,
} from "@/lib/users/profile";

/**
 * The profile editor. Every field here is stored in `public.profiles` and written
 * through `PATCH /api/v1/users/me`, which resolves the row from the verified
 * token — the form has no user id to send even if it wanted to.
 *
 * Usernames follow the database rule: 3–24 lowercase letters, digits and
 * underscores, unique case-insensitively. The form validates the shape before
 * sending; a name someone else holds is refused by the unique index and
 * reported under the field.
 */
export function ProfileForm() {
  const state = useProfile();

  if (state.status === "ready") return <Editor profile={state.profile} />;
  if (state.status === "idle" || state.status === "loading") return <Loading />;
  if (state.status === "anonymous") {
    return (
      <div className="px-4 md:px-0">
        <EmptyState
          title="Sign in to edit your profile"
          body="Your name, username, bio and photo belong to your account."
          action={
            <Button asChild>
              <Link to="/login" search={{ redirect: "/settings/profile" }}>
                Log in
              </Link>
            </Button>
          }
        />
      </div>
    );
  }
  if (state.status === "missing") {
    return (
      <div className="px-4 md:px-0">
        <EmptyState
          title="No profile yet"
          body="This account has no profile stored, so there is nothing to edit. Try again in a moment."
          action={
            <Button variant="secondary" onClick={() => void refreshProfile()}>
              Try again
            </Button>
          }
        />
      </div>
    );
  }
  return (
    <div className="px-4 md:px-0">
      <ErrorState
        title="Couldn't load your profile"
        body={state.error.message}
        onRetry={() => void refreshProfile()}
      />
    </div>
  );
}

/** The same three fields, drawn as skeletons until the profile arrives. */
function Loading() {
  return (
    <div className="space-y-4 px-4 md:px-0" aria-busy="true" aria-label="Loading">
      <div className="flex items-center gap-4">
        <Skeleton className="size-24 rounded-full" />
        <Skeleton className="h-9 w-32 rounded-md" />
      </div>
      <div className="space-y-2">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-12 w-full rounded-lg" />
      </div>
      <div className="space-y-2">
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-12 w-full rounded-lg" />
      </div>
      <div className="space-y-2">
        <Skeleton className="h-4 w-12" />
        <Skeleton className="h-20 w-full rounded-lg" />
      </div>
    </div>
  );
}

/**
 * The client side of the username rule. It mirrors `profiles_username_format`
 * (`^[a-z0-9_]{3,24}$`) so a bad value fails here with a message instead of as
 * a server refusal — the database stays the authority behind it.
 */
function validateUsername(value: string): string | undefined {
  if (value === "") return "Add a username.";
  // Spread into code points, the way the API counts runes: a length error and
  // a format error stay distinct even for non-ASCII input.
  const length = [...value].length;
  if (length < 3 || length > 24) {
    return "Use 3–24 characters for your username.";
  }
  if (!/^[a-z0-9_]+$/.test(value)) {
    return "Use only lowercase letters, numbers and underscores.";
  }
  return undefined;
}

function Editor({ profile }: { profile: Profile }) {
  const navigate = useNavigate();
  // The form edits a draft that starts as the stored profile. Keeping it as
  // `undefined` until the first keystroke means the fields always show what the
  // server holds, and an edit in progress is never silently replaced by a
  // refresh — except after a conflict, where the draft is the thing at fault.
  const [draft, setDraft] = useState<{ displayName: string; username: string; bio: string }>();
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<string>();
  const [errors, setErrors] = useState<{ displayName?: string; username?: string; bio?: string }>(
    {},
  );
  const file = useRef<HTMLInputElement>(null);

  const value = draft ?? {
    displayName: profile.displayName,
    username: profile.username,
    bio: profile.bio ?? "",
  };

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const displayName = value.displayName.trim();
    if (displayName === "") {
      setErrors({ displayName: "Add a display name." });
      setBanner(undefined);
      return;
    }

    const username = value.username.trim();
    const usernameError = validateUsername(username);
    if (usernameError) {
      setErrors({ username: usernameError });
      setBanner(undefined);
      return;
    }

    const bio = value.bio.trim();
    setBusy(true);
    setBanner(undefined);
    setErrors({});
    try {
      await updateProfile({
        displayName,
        // An unchanged username is not sent: the row's `updatedAt` is the
        // concurrency control, and a no-op write would still move it.
        ...(username !== profile.username ? { username } : {}),
        // An emptied bio is stored as "no bio", not as an empty string.
        bio: bio === "" ? null : bio,
        // The version this form was loaded against. If the row moved on, the API
        // refuses the write instead of overwriting a change nobody saw.
        expectedUpdatedAt: profile.updatedAt,
      });
      setDraft(undefined);
      toast.success("Profile saved");
    } catch (error) {
      if (error instanceof ApiError && error.status === 409 && !fieldError(error, "username")) {
        // Somebody else's edit landed first — but not a taken username, which
        // names its field below and keeps the draft. Re-read so the form shows
        // the stored values, and let the user apply their edit again on top.
        setDraft(undefined);
        void refreshProfile();
      }
      const attributed = {
        displayName: fieldError(error, "displayName"),
        username: fieldError(error, "username"),
        bio: fieldError(error, "bio"),
      };
      setErrors(attributed);
      // A message shown under its own field is not repeated in the banner.
      if (!attributed.displayName && !attributed.username && !attributed.bio) {
        setBanner(profileErrorMessage(error));
      }
    } finally {
      setBusy(false);
    }
  }

  async function pick(event: ChangeEvent<HTMLInputElement>) {
    const chosen = event.target.files?.[0];
    // Clear the input first, so choosing the same file again after a failure
    // still counts as a change.
    event.target.value = "";
    if (!chosen) return;

    setBusy(true);
    setBanner(undefined);
    try {
      await changeAvatar(chosen);
      toast.success("Photo updated");
      // Show the new photo where others see it.
      void navigate({ to: "/profile" });
    } catch (error) {
      setBanner(profileErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="space-y-4 px-4 md:px-0" onSubmit={submit}>
      <div className="flex items-center gap-4">
        <Avatar name={profile.username} src={avatarUrl(profile)} size="xl" />
        <input
          ref={file}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          aria-label="Choose a profile picture"
          onChange={pick}
        />
        <Button
          type="button"
          variant="secondary"
          disabled={busy}
          onClick={() => file.current?.click()}
        >
          Change photo
        </Button>
      </div>
      <Field
        id="name"
        label="Display name"
        value={value.displayName}
        maxLength={60}
        required
        error={errors.displayName}
        onChange={(event) => setDraft({ ...value, displayName: event.target.value })}
      />
      <Field
        id="username"
        label="Username"
        value={value.username}
        maxLength={24}
        required
        hint="3–24 characters: lowercase letters, numbers, underscores."
        error={errors.username}
        onChange={(event) => setDraft({ ...value, username: event.target.value })}
      />
      <div className="space-y-1.5">
        <Label htmlFor="bio">Bio</Label>
        <Textarea
          id="bio"
          value={value.bio}
          maxLength={120}
          className="bg-surface"
          aria-invalid={!!errors.bio}
          onChange={(event) => setDraft({ ...value, bio: event.target.value })}
        />
        <p className="text-xs text-muted-foreground">Up to 120 characters.</p>
        {errors.bio && <p className="text-xs text-destructive">{errors.bio}</p>}
      </div>
      {banner && (
        <p className="text-sm text-destructive" role="alert">
          {banner}
        </p>
      )}
      <Button type="submit" size="lg" className="w-full md:w-auto" disabled={busy}>
        Save changes
      </Button>
    </form>
  );
}
