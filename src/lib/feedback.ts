/**
 * In-app feedback, stored in `public.feedback` through the Data API.
 *
 * RLS is the boundary: a row is accepted only when `user_id` is the verified
 * caller, and a trigger caps how many a player sends per hour. The sender's
 * id comes from the session, never from a form field. The device note is
 * optional and short: viewport and browser string, nothing that identifies the
 * person beyond the account they are already signed in with.
 */

import { ApiError } from "@/lib/api/client";
import { getAccessToken, getAuthState } from "@/lib/auth/session";
import { restMutate, SupabaseRestError } from "@/lib/supabase/rest";

export const MAX_FEEDBACK_LENGTH = 2000;
export const MIN_FEEDBACK_LENGTH = 3;

export type FeedbackCategory = "idea" | "bug" | "praise" | "other";

export type FeedbackInput = {
  /** 1 (rough) to 5 (love it). */
  mood: number;
  category: FeedbackCategory;
  message: string;
  includeDevice: boolean;
};

function deviceNote(): string | null {
  if (typeof window === "undefined" || typeof navigator === "undefined") return null;
  return `${window.innerWidth}x${window.innerHeight} · ${navigator.userAgent}`.slice(0, 300);
}

export async function sendFeedback(input: FeedbackInput): Promise<void> {
  const token = getAccessToken();
  const auth = getAuthState();
  if (!token || auth.status !== "authenticated") {
    throw new ApiError("Sign in to send feedback.", { code: "unauthorized", status: 401 });
  }
  const message = input.message.trim();
  if (message.length < MIN_FEEDBACK_LENGTH) {
    throw new ApiError("Tell us a little more.", { code: "bad_request", status: 400 });
  }
  if (message.length > MAX_FEEDBACK_LENGTH) {
    throw new ApiError(`Keep feedback to ${MAX_FEEDBACK_LENGTH} characters or fewer.`, {
      code: "bad_request",
      status: 400,
    });
  }
  try {
    await restMutate("feedback", "POST", token, {
      user_id: auth.session.userId,
      mood: input.mood,
      category: input.category,
      message,
      context: input.includeDevice ? deviceNote() : null,
    });
  } catch (error) {
    if (error instanceof SupabaseRestError) {
      if (error.status === 401) {
        throw new ApiError("Sign in to send feedback.", { code: "unauthorized", status: 401 });
      }
      // The per-hour cap is a check violation raised by the trigger.
      if (error.status === 400 || error.code === "23514") {
        throw new ApiError("You've sent a lot of feedback. Please try again in a little while.", {
          code: "rate_limited",
          status: 429,
        });
      }
      throw new ApiError("Couldn't send your feedback. Try again.", {
        code: "feedback_failed",
        status: error.status,
      });
    }
    throw new ApiError("Couldn't send your feedback. Try again.", { code: "feedback_failed" });
  }
}
