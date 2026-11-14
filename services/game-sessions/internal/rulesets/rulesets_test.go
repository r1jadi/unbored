package rulesets

import "testing"

func TestLookupRoutesEachFamilyToItsVerifier(t *testing.T) {
	for version, verifier := range map[string]string{
		"decant@2":      "complete_decant_run",
		"fjalekryqi@1":  "complete_fjalekryqi_run",
		"checkmate@1":   "complete_checkmate_run",
		"cascade@9":     "complete_cascade_run",
		"bolted@1":      "complete_bolted_run",
		"fusebox@1":     "complete_fusebox_run",
		"minefield@1":   "complete_minefield_run",
		"queens@1":      "complete_queens_run",
		"queens@2":      "complete_queens_speed_run",
		"sudoku@3":      "complete_sudoku_run",
		"sudoku@4":      "complete_sudoku_speed_run",
		"mini-sudoku@1": "complete_mini_sudoku_run",
		"mini-sudoku@2": "complete_mini_sudoku_speed_run",
		"sumdoku@1":     "complete_sumdoku_run",
		"whittle@1":     "complete_whittle_run",
		"flipside@1":    "complete_flipside_run",
		"guesswork@1":   "complete_guesswork_run",
		"deep-cut@1":    "complete_deep_cut_run",
		"gjeje@1":       "complete_gjeje_run",
	} {
		if got := Lookup(version).Verifier; got != verifier {
			t.Errorf("Lookup(%q).Verifier = %q, want %q", version, got, verifier)
		}
	}
}

func TestLookupKeepsTheRetiredVersionsBounds(t *testing.T) {
	cases := []struct {
		version     string
		maxActions  int
		actionCodes int
	}{
		{"stack-10@1", 60, 4},
		{"stack-10@2", 4096, 4},
		{"memory-flash@1", 60, 16},
		{"memory-flash@2", 4096, 225},
		{"one-move@1", 60, 25},
		{"one-move@2", 4096, 1026 * 1026},
		{"dont-touch@1", 60, 60},
		{"dont-touch@2", 4095, 4095},
	}
	for _, c := range cases {
		got := Lookup(c.version)
		if got.MaxActions != c.maxActions || got.ActionCodes != c.actionCodes {
			t.Errorf("Lookup(%q) = %d actions / %d codes, want %d / %d",
				c.version, got.MaxActions, got.ActionCodes, c.maxActions, c.actionCodes)
		}
	}
}

func TestLookupSendsAnUnknownVersionToTheFallback(t *testing.T) {
	// The fallback verifier answers wrong_rules for a version it does not own,
	// so an unknown version is a refusal, never a pass.
	if got := Lookup("nonsense@1"); got != fallback {
		t.Fatalf("Lookup(nonsense@1) = %+v, want the fallback", got)
	}
}
