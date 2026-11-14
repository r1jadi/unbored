package admin

import (
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/r1jadi/unbored/packages/go/platform/apierr"
	"github.com/r1jadi/unbored/packages/go/platform/httpx"
)

// The Deep Cut review queue: spellings the answer bank did not know, which the AI
// judge ruled on or could not, and the answers they can be filed under.
//
//   - GET   /admin/deep-cut/reviews lists them (pending by default, most played first).
//   - GET   /admin/deep-cut/questions/{questionID}/answers lists a question's answers.
//   - PUT   /admin/deep-cut/questions/{questionID}/reviews/{key} rules on a spelling.
//   - PATCH /admin/deep-cut/answers/{answerID} moves an answer to another tier.
//
// All four are staff routes: moderators and administrators.
const (
	DeepCutReviewsPath  = "/api/v1/admin/deep-cut/reviews"
	DeepCutAnswersPath  = "/api/v1/admin/deep-cut/questions/{questionID}/answers"
	DeepCutReviewPath   = "/api/v1/admin/deep-cut/questions/{questionID}/reviews/{key}"
	DeepCutAnswerPath   = "/api/v1/admin/deep-cut/answers/{answerID}"
	maxDeepCutNameRunes = 60
)

var (
	deepCutVerdicts = []string{"pending", "accepted", "rejected", "all"}
	deepCutKey      = regexp.MustCompile(`^[a-z0-9]{1,60}$`)
)

type deepCutReviewView struct {
	QuestionID   int        `json:"questionId"`
	QuestionSlug string     `json:"questionSlug"`
	Category     string     `json:"category"`
	Prompt       string     `json:"prompt"`
	Key          string     `json:"key"`
	Sample       string     `json:"sample"`
	Verdict      string     `json:"verdict"`
	Reviewer     *string    `json:"reviewer"`
	Seen         int        `json:"seen"`
	FirstSeen    time.Time  `json:"firstSeen"`
	ReviewedAt   *time.Time `json:"reviewedAt"`
	AnswerID     *int       `json:"answerId"`
	AnswerName   *string    `json:"answerName"`
	AnswerTier   *int       `json:"answerTier"`
}

type deepCutAnswerView struct {
	ID            int      `json:"id"`
	Canonical     string   `json:"canonical"`
	Tier          int      `json:"tier"`
	Source        string   `json:"source"`
	Spellings     int      `json:"spellings"`
	Given         int64    `json:"given"`
	SharePercent  *float64 `json:"sharePercent"`
	SuggestedTier *int     `json:"suggestedTier"`
}

func (s *service) registerDeepCut(router *httpx.Router) {
	router.AuthenticatedFunc("GET "+DeepCutReviewsPath, s.staff(s.listDeepCutReviews))
	router.AuthenticatedFunc("GET "+DeepCutAnswersPath, s.staff(s.listDeepCutAnswers))
	router.AuthenticatedFunc("PUT "+DeepCutReviewPath, s.staff(s.ruleDeepCut))
	router.AuthenticatedFunc("PATCH "+DeepCutAnswerPath, s.staff(s.retierDeepCut))
}

// positiveID reads a numeric path parameter.
func positiveID(w http.ResponseWriter, r *http.Request, name, what string) (int, bool) {
	value, err := strconv.Atoi(strings.TrimSpace(r.PathValue(name)))
	if err != nil || value <= 0 || value > 1<<30 {
		httpx.WriteError(w, r, httpx.NewError(httpx.CodeBadRequest,
			"That is not a valid "+what+" id.", apierr.Detail{Field: name, Rule: "format"}))
		return 0, false
	}
	return value, true
}

func (s *service) listDeepCutReviews(w http.ResponseWriter, r *http.Request) {
	page, ok := s.page(w, r)
	if !ok {
		return
	}
	verdict := strings.TrimSpace(r.URL.Query().Get("verdict"))
	if verdict == "" {
		verdict = "pending"
	}
	if !contains(deepCutVerdicts, verdict) {
		httpx.WriteError(w, r, httpx.NewError(httpx.CodeBadRequest,
			"verdict must be one of pending, accepted, rejected or all.",
			apierr.Detail{Field: "verdict", Rule: "unsupported"}))
		return
	}
	if verdict == "all" {
		verdict = ""
	}
	search, ok := s.search(w, r)
	if !ok {
		return
	}

	rows, err := s.backend.DeepCutReviews(r.Context(), s.token(r), s.actor(r), verdict, search, page)
	if err != nil {
		s.dataFailure(w, r, "list Deep Cut reviews", err)
		return
	}
	items := make([]deepCutReviewView, 0, min(len(rows), page.Limit))
	for _, row := range rows[:min(len(rows), page.Limit)] {
		items = append(items, deepCutReviewView{
			QuestionID:   row.QuestionID,
			QuestionSlug: row.QuestionSlug,
			Category:     row.Category,
			Prompt:       row.Prompt,
			Key:          row.Key,
			Sample:       row.Sample,
			Verdict:      row.Verdict,
			Reviewer:     row.Reviewer,
			Seen:         row.Seen,
			FirstSeen:    row.FirstSeen,
			ReviewedAt:   row.ReviewedAt,
			AnswerID:     row.AnswerID,
			AnswerName:   row.AnswerName,
			AnswerTier:   row.AnswerTier,
		})
	}
	s.writePage(w, r, items, len(rows) > page.Limit)
}

func (s *service) listDeepCutAnswers(w http.ResponseWriter, r *http.Request) {
	questionID, ok := positiveID(w, r, "questionID", "question")
	if !ok {
		return
	}
	rows, err := s.backend.DeepCutAnswers(r.Context(), s.token(r), s.actor(r), questionID)
	if err != nil {
		s.dataFailure(w, r, "list Deep Cut answers", err)
		return
	}
	items := make([]deepCutAnswerView, 0, len(rows))
	for _, row := range rows {
		items = append(items, deepCutAnswerView{
			ID: row.ID, Canonical: row.Canonical, Tier: row.Tier,
			Source: row.Source, Spellings: row.Spellings, Given: row.Given,
			SharePercent: row.SharePercent, SuggestedTier: row.SuggestedTier,
		})
	}
	httpx.WriteJSON(w, r, http.StatusOK, struct {
		Items []deepCutAnswerView `json:"items"`
	}{Items: items})
}

type ruleDeepCutRequest struct {
	Verdict   string `json:"verdict"`
	Canonical string `json:"canonical"`
	Tier      int    `json:"tier"`
}

func (s *service) ruleDeepCut(w http.ResponseWriter, r *http.Request) {
	questionID, ok := positiveID(w, r, "questionID", "question")
	if !ok {
		return
	}
	key := strings.TrimSpace(r.PathValue("key"))
	if !deepCutKey.MatchString(key) {
		httpx.WriteError(w, r, httpx.NewError(httpx.CodeBadRequest,
			"That is not a valid spelling key.", apierr.Detail{Field: "key", Rule: "format"}))
		return
	}
	var body ruleDeepCutRequest
	if !s.decode(w, r, &body) {
		return
	}
	verdict := strings.TrimSpace(body.Verdict)
	canonical := strings.TrimSpace(body.Canonical)
	switch verdict {
	case "accepted":
		if canonical == "" || len([]rune(canonical)) > maxDeepCutNameRunes {
			httpx.WriteError(w, r, httpx.NewError(httpx.CodeBadRequest,
				"An accepted spelling needs the answer's name, at most 60 characters.",
				apierr.Detail{Field: "canonical", Rule: "required"}))
			return
		}
		if body.Tier < 1 || body.Tier > 6 {
			httpx.WriteError(w, r, httpx.NewError(httpx.CodeBadRequest,
				"An accepted spelling needs a tier from 1 to 6.",
				apierr.Detail{Field: "tier", Rule: "range"}))
			return
		}
	case "rejected":
		canonical, body.Tier = "", 0
	default:
		httpx.WriteError(w, r, httpx.NewError(httpx.CodeBadRequest,
			"verdict must be accepted or rejected.",
			apierr.Detail{Field: "verdict", Rule: "unsupported"}))
		return
	}

	result, err := s.backend.RuleDeepCut(r.Context(), s.token(r), s.actor(r), questionID, key, verdict, canonical, body.Tier)
	if err != nil {
		s.moderationFailure(w, r, "rule on a Deep Cut answer", err)
		return
	}
	httpx.WriteJSON(w, r, http.StatusOK, struct {
		QuestionID      int     `json:"questionId"`
		Key             string  `json:"key"`
		PreviousVerdict *string `json:"previousVerdict"`
		Verdict         string  `json:"verdict"`
	}{result.QuestionID, result.Key, result.PreviousVerdict, result.Verdict})
}

type retierDeepCutRequest struct {
	Tier int `json:"tier"`
}

func (s *service) retierDeepCut(w http.ResponseWriter, r *http.Request) {
	answerID, ok := positiveID(w, r, "answerID", "answer")
	if !ok {
		return
	}
	var body retierDeepCutRequest
	if !s.decode(w, r, &body) {
		return
	}
	if body.Tier < 1 || body.Tier > 6 {
		httpx.WriteError(w, r, httpx.NewError(httpx.CodeBadRequest,
			"A tier is 1 to 6.", apierr.Detail{Field: "tier", Rule: "range"}))
		return
	}
	result, err := s.backend.SetDeepCutTier(r.Context(), s.token(r), s.actor(r), answerID, body.Tier)
	if err != nil {
		s.moderationFailure(w, r, "re-tier a Deep Cut answer", err)
		return
	}
	httpx.WriteJSON(w, r, http.StatusOK, struct {
		AnswerID     int `json:"answerId"`
		PreviousTier int `json:"previousTier"`
		Tier         int `json:"tier"`
	}{result.AnswerID, result.PreviousTier, result.Tier})
}
