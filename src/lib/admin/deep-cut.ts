/**
 * The admin console's Deep Cut review queue, as `services/admin/deepcut.go`
 * defines it: spellings the answer bank did not know, the answers they can be
 * filed under, a ruling on one, and moving an answer to another tier.
 *
 * Every call carries the caller's token; the server and the database decide
 * whether they are staff.
 */

import { ApiError, apiFetch } from "@/lib/api/client";
import { getAccessToken } from "@/lib/auth/session";
import { useResource } from "@/lib/admin/api";
import { t } from "@/lib/settings/language";

const Routes = {
  reviews: "/admin/deep-cut/reviews",
  answers: (questionId: number) => `/admin/deep-cut/questions/${questionId}/answers`,
  review: (questionId: number, key: string) =>
    `/admin/deep-cut/questions/${questionId}/reviews/${encodeURIComponent(key)}`,
  answer: (answerId: number) => `/admin/deep-cut/answers/${answerId}`,
};

export type DeepCutVerdict = "pending" | "accepted" | "rejected";
export type DeepCutTier = 1 | 2 | 3 | 4 | 5 | 6;

/** One spelling in the queue, as `admin_deep_cut_reviews` returns it. */
export type AdminDeepCutReview = {
  questionId: number;
  questionSlug: string;
  category: string;
  prompt: string;
  key: string;
  sample: string;
  verdict: DeepCutVerdict;
  reviewer: "ai" | "staff" | null;
  /** How many players typed this spelling. */
  seen: number;
  firstSeen: string;
  reviewedAt: string | null;
  answerId: number | null;
  answerName: string | null;
  answerTier: DeepCutTier | null;
};

/** One answer to a question. */
export type AdminDeepCutAnswer = {
  id: number;
  canonical: string;
  tier: DeepCutTier;
  source: "curated" | "ai" | "staff";
  spellings: number;
  /** How many times players gave it and scored. */
  given: number;
  /** Its share of every answer given to the question, once there are 100. */
  sharePercent: number | null;
  /** The tier that share suggests; null until there is enough play. */
  suggestedTier: DeepCutTier | null;
};

export type DeepCutReviewFilters = {
  verdict?: DeepCutVerdict | "all";
  q?: string;
  limit?: number;
  offset?: number;
};

type Page<T> = { items: T[]; hasMore: boolean };

function requireToken(): string {
  const token = getAccessToken();
  if (!token) {
    throw new ApiError(t("Sign in to continue."), { code: "unauthorized", status: 401 });
  }
  return token;
}

export async function fetchDeepCutReviews(
  filters: DeepCutReviewFilters,
  signal?: AbortSignal,
): Promise<Page<AdminDeepCutReview>> {
  return apiFetch<Page<AdminDeepCutReview>>(Routes.reviews, {
    token: requireToken(),
    query: { ...filters },
    signal,
  });
}

export async function fetchDeepCutAnswers(
  questionId: number,
  signal?: AbortSignal,
): Promise<AdminDeepCutAnswer[]> {
  const body = await apiFetch<{ items: AdminDeepCutAnswer[] }>(Routes.answers(questionId), {
    token: requireToken(),
    signal,
  });
  return body.items;
}

/** Files a spelling under an answer (existing or new), or rejects it. */
export async function ruleDeepCut(
  questionId: number,
  key: string,
  ruling: { verdict: "accepted"; canonical: string; tier: DeepCutTier } | { verdict: "rejected" },
): Promise<{ verdict: DeepCutVerdict; previousVerdict: DeepCutVerdict | null }> {
  return apiFetch(Routes.review(questionId, key), {
    method: "PUT",
    token: requireToken(),
    body: ruling,
  });
}

/** Moves an answer to another tier; the bank's next load keeps it there. */
export async function setDeepCutTier(
  answerId: number,
  tier: DeepCutTier,
): Promise<{ answerId: number; previousTier: number; tier: number }> {
  return apiFetch(Routes.answer(answerId), {
    method: "PATCH",
    token: requireToken(),
    body: { tier },
  });
}

export function useDeepCutReviews(filters: DeepCutReviewFilters) {
  const { verdict = "pending", q, limit, offset = 0 } = filters;
  return useResource<Page<AdminDeepCutReview>>(
    (signal) => fetchDeepCutReviews({ verdict, q, limit, offset }, signal),
    [verdict, q, limit, offset],
  );
}

export function useDeepCutAnswers(questionId: number | null, version = 0) {
  return useResource<AdminDeepCutAnswer[]>(
    (signal) =>
      questionId === null ? Promise.resolve([]) : fetchDeepCutAnswers(questionId, signal),
    [questionId, version],
  );
}
