package supabaseadmin

import (
	"context"
	"time"
)

// DeepCutReview is one spelling the Deep Cut bank did not know, with its verdict
// and, once accepted, the answer it was filed under.
type DeepCutReview struct {
	QuestionID   int        `json:"question_id"`
	QuestionSlug string     `json:"question_slug"`
	Category     string     `json:"category"`
	Prompt       string     `json:"prompt"`
	Key          string     `json:"key"`
	Sample       string     `json:"sample"`
	Verdict      string     `json:"verdict"`
	Reviewer     *string    `json:"reviewer"`
	Seen         int        `json:"seen"`
	FirstSeen    time.Time  `json:"first_seen"`
	ReviewedAt   *time.Time `json:"reviewed_at"`
	AnswerID     *int       `json:"answer_id"`
	AnswerName   *string    `json:"answer_name"`
	AnswerTier   *int       `json:"answer_tier"`
}

// DeepCutReviews reads one page of the Deep Cut review queue. An empty verdict is
// every verdict; an empty search leaves that filter unset.
func (c *Client) DeepCutReviews(ctx context.Context, token, actor, verdict, search string, page Page) ([]DeepCutReview, error) {
	payload := map[string]any{
		"p_verdict": nullable(verdict),
		"p_search":  nullable(search),
		"p_limit":   page.Limit + 1,
		"p_offset":  page.Offset,
	}
	var rows []DeepCutReview
	if err := c.invoke(ctx, "deep-cut-reviews", "admin_deep_cut_reviews", "admin_deep_cut_reviews_svc", payload, token, actor, &rows); err != nil {
		return nil, err
	}
	return rows, nil
}

// DeepCutAnswer is one answer to a Deep Cut question.
type DeepCutAnswer struct {
	ID        int    `json:"id"`
	Canonical string `json:"canonical"`
	Tier      int    `json:"tier"`
	Source    string `json:"source"`
	Spellings int    `json:"spellings"`
	Given     int64  `json:"given"`
	// SharePercent is this answer's share of every answer given to the question,
	// once there are enough; SuggestedTier is the tier that share implies.
	SharePercent  *float64 `json:"share_percent"`
	SuggestedTier *int     `json:"suggested_tier"`
}

// DeepCutAnswers reads one question's answers, surface first.
func (c *Client) DeepCutAnswers(ctx context.Context, token, actor string, questionID int) ([]DeepCutAnswer, error) {
	var rows []DeepCutAnswer
	if err := c.invoke(ctx, "deep-cut-answers", "admin_deep_cut_answers", "admin_deep_cut_answers_svc",
		map[string]any{"p_question_id": questionID}, token, actor, &rows); err != nil {
		return nil, err
	}
	return rows, nil
}

// DeepCutRuling is what a staff ruling answers with.
type DeepCutRuling struct {
	QuestionID      int     `json:"questionId"`
	Key             string  `json:"key"`
	PreviousVerdict *string `json:"previousVerdict"`
	Verdict         string  `json:"verdict"`
}

// RuleDeepCut records staff's ruling on a spelling. canonical and tier are used
// only for an accepted spelling.
func (c *Client) RuleDeepCut(ctx context.Context, token, actor string, questionID int, key, verdict, canonical string, tier int) (DeepCutRuling, error) {
	payload := map[string]any{
		"p_question_id": questionID,
		"p_key":         key,
		"p_verdict":     verdict,
		"p_canonical":   nullable(canonical),
		"p_tier":        nil,
	}
	if tier > 0 {
		payload["p_tier"] = tier
	}
	var result DeepCutRuling
	if err := c.invoke(ctx, "deep-cut-rule", "admin_deep_cut_rule", "admin_deep_cut_rule_svc", payload, token, actor, &result); err != nil {
		return DeepCutRuling{}, err
	}
	return result, nil
}

// DeepCutRetier is what a re-tier answers with.
type DeepCutRetier struct {
	AnswerID     int `json:"answerId"`
	PreviousTier int `json:"previousTier"`
	Tier         int `json:"tier"`
}

// SetDeepCutTier moves an answer to another tier and pins it there.
func (c *Client) SetDeepCutTier(ctx context.Context, token, actor string, answerID, tier int) (DeepCutRetier, error) {
	var result DeepCutRetier
	if err := c.invoke(ctx, "deep-cut-set-tier", "admin_deep_cut_set_tier", "admin_deep_cut_set_tier_svc",
		map[string]any{"p_answer_id": answerID, "p_tier": tier}, token, actor, &result); err != nil {
		return DeepCutRetier{}, err
	}
	return result, nil
}
