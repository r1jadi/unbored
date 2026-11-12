// Package rulesets is the one table of what the game-sessions service knows
// about each game's rules: which database function verifies a run, how many
// actions a submission may carry, and how many action codes there are.
//
// A rules version is `family@n` (`decant@2`). Each family has one entry, and a
// few retired versions keep their own bounds as overrides. Adding a game is one
// entry here — the database learns it in its migration, the client in its
// runtime registry.
//
// These are request bounds, not the rules: they keep a malformed or absurd body
// from reaching the database. Whether a sequence of actions is possible is each
// verifier's call.
package rulesets

import "strings"

// Ruleset is what the service needs to check and route one rules version.
type Ruleset struct {
	// Verifier is the database function that replays and records a run.
	Verifier string
	// MaxActions is the most actions one submission may carry.
	MaxActions int
	// ActionCodes bounds every action: each must be 0 to ActionCodes − 1.
	ActionCodes int
}

// fallback is what a version no family owns gets: the Stack 10 verifier, which
// answers wrong_rules for a version it does not implement, so an unknown
// version is still a refusal, never a pass.
var fallback = Ruleset{Verifier: "complete_stack10_run", MaxActions: 60, ActionCodes: 4}

// families maps a rules family to its ruleset.
var families = map[string]Ruleset{
	// The first games' retired @1 rules were finite: sixty tiles for Stack 10,
	// fifty-five taps for a perfect legacy Chain run, forty-eight slides for
	// Color Merge. Their endless @2 rules carry up to 4096 (see overrides).
	// Stack 10 addresses a column and Chain a pad, 0 to 3; Color Merge one of its
	// four directions.
	"stack-10":    {Verifier: "complete_stack10_run", MaxActions: 60, ActionCodes: 4},
	"chain":       {Verifier: "complete_chain_run", MaxActions: 60, ActionCodes: 4},
	"color-merge": {Verifier: "complete_color_merge_run", MaxActions: 60, ActionCodes: 4},
	// Memory Flash addresses a cell: up to fifteen by fifteen for the endless
	// rules (sixteen cells for the retired 4×4, an override).
	"memory-flash": {Verifier: "complete_memory_flash_run", MaxActions: 60, ActionCodes: 225},
	// One Move addresses a cell of its board: 1026×1026 is the side the endless
	// rules reach at the submission bound (3 + (level − 1) / 4 at level 4096).
	"one-move": {Verifier: "complete_one_move_run", MaxActions: 60, ActionCodes: 1026 * 1026},
	// Don't Touch the Black taps its endless conveyor's 4095 cells, each once.
	"dont-touch": {Verifier: "complete_dont_touch_run", MaxActions: 4095, ActionCodes: 4095},
	// 7 Second answers sixty questions with one of three choices.
	"seven-second": {Verifier: "complete_seven_second_run", MaxActions: 60, ActionCodes: 3},
	// Queens taps cells of a board up to 9×9; notes (Xs) are taps too.
	"queens": {Verifier: "complete_queens_run", MaxActions: 8192, ActionCodes: 81},
	// Zip's drawn path enters cells of a board up to 7×7.
	"zip": {Verifier: "complete_zip_run", MaxActions: 8192, ActionCodes: 49},
	// 8 Puzzle slides a cell of the 3×3 board.
	"eight-puzzle": {Verifier: "complete_eight_puzzle_run", MaxActions: 8192, ActionCodes: 9},
	// Tango taps a cell of the 6×6 board.
	"tango": {Verifier: "complete_tango_run", MaxActions: 8192, ActionCodes: 36},
	// Sudoku moves are cell × 10 + digit, 0 (cell 0 cleared) to 809 (a 9 in cell 80).
	"sudoku": {Verifier: "complete_sudoku_run", MaxActions: 8192, ActionCodes: 810},
	// Mini Sudoku: cell × 10 + digit on the 6×6 board, 0 to 356.
	"mini-sudoku": {Verifier: "complete_mini_sudoku_run", MaxActions: 8192, ActionCodes: 360},
	// The crossword and Fjalekryqi (the Albanian crossword) carry a day's solve:
	// a letter as cell × 32 + code (up to 48 × 32 + 28), a check (1600) and a
	// reveal (1700 + cell, up to 1748). The verifiers refuse the codes between.
	"crossword":  {Verifier: "complete_crossword_run", MaxActions: 2048, ActionCodes: 1749},
	"fjalekryqi": {Verifier: "complete_fjalekryqi_run", MaxActions: 2048, ActionCodes: 1749},
	// Gridburst places a tray slot's piece with its corner on a cell: slot × 64 + cell.
	"gridburst": {Verifier: "complete_gridburst_run", MaxActions: 4096, ActionCodes: 3 * 64},
	// Updraft (Flutter): 2 × tick for a flap and 2 × tick + 1 for a stop, over
	// the 108 000 ticks (thirty minutes at sixty a second) a run may last.
	"updraft": {Verifier: "complete_updraft_run", MaxActions: 8192, ActionCodes: 2*108000 + 2},
	// Flipside: 2 × tick for a tap and 2 × tick + 1 for a stop, over the same
	// thirty-minute bound of 108 000 ticks.
	"flipside": {Verifier: "complete_flipside_run", MaxActions: 8192, ActionCodes: 2*108000 + 2},
	// Decant: a pour as from × 16 + to (up to 187 with twelve tubes), then 253 an
	// extra tube, 254 undo and 255 restart.
	"decant": {Verifier: "complete_decant_run", MaxActions: 8192, ActionCodes: 256},
	// Scatter taps a cell of a board up to 7×7.
	"scatter": {Verifier: "complete_scatter_run", MaxActions: 4096, ActionCodes: 49},
	// Huedini: a slide as top-left cell × 4 + direction (up to 195 on the 7×7
	// board), then 254 undo and 255 restart.
	"huedini": {Verifier: "complete_huedini_run", MaxActions: 8192, ActionCodes: 256},
	// Cascade swaps cell × 2 + direction, 0 right and 1 down, on the 8×8 board.
	// The verifier refuses a swap off the edge.
	"cascade": {Verifier: "complete_cascade_run", MaxActions: 4096, ActionCodes: 128},
	// Checkmate: a move as from × 64 + to, 0 to 4095, then 4096 a skip.
	"checkmate": {Verifier: "complete_checkmate_run", MaxActions: 2048, ActionCodes: 4097},
	// Bolted: a move as from × 16 + to (up to 170 with eleven bolts), then 253 an
	// extra bolt, 254 undo and 255 restart.
	"bolted": {Verifier: "complete_bolted_run", MaxActions: 8192, ActionCodes: 256},
	// Fusebox taps a cell of the 6×6 board.
	"fusebox": {Verifier: "complete_fusebox_run", MaxActions: 4096, ActionCodes: 36},
	// Minefield opens a cell of a board up to 10×10, or flags one as 100 + cell.
	"minefield": {Verifier: "complete_minefield_run", MaxActions: 4096, ActionCodes: 200},
	// Sumdoku: cell × 10 + digit on the 6×6 board, 0 to 356, as Mini Sudoku.
	"sumdoku": {Verifier: "complete_sumdoku_run", MaxActions: 8192, ActionCodes: 360},
	// Whittle: cell × 10 + mark on the 5×5 board, 0 to 242.
	"whittle": {Verifier: "complete_whittle_run", MaxActions: 8192, ActionCodes: 250},
	// Guesswork and Gjeje (the Albanian Guesswork) carry a day's guesses, six at
	// most: five letters packed five bits each, so every code is below 32⁵. The
	// verifiers refuse a code that is not a listed word.
	"guesswork": {Verifier: "complete_guesswork_run", MaxActions: 6, ActionCodes: 1 << 25},
	"gjeje":     {Verifier: "complete_gjeje_run", MaxActions: 6, ActionCodes: 1 << 25},
}

// overrides are the versions whose bounds differ from their family's: the
// endless @2 rules of the first games, and the retired finite boards.
var overrides = map[string]Ruleset{
	"stack-10@2":    {Verifier: "complete_stack10_run", MaxActions: 4096, ActionCodes: 4},
	"chain@2":       {Verifier: "complete_chain_run", MaxActions: 4096, ActionCodes: 4},
	"color-merge@2": {Verifier: "complete_color_merge_run", MaxActions: 4096, ActionCodes: 4},
	// The retired 4×4 board; the endless rules carry up to 4096 taps.
	"memory-flash@1": {Verifier: "complete_memory_flash_run", MaxActions: 60, ActionCodes: 16},
	"memory-flash@2": {Verifier: "complete_memory_flash_run", MaxActions: 4096, ActionCodes: 225},
	// The retired 5×5 maximum, twelve taps for a perfect run; the endless rules carry 4096.
	"one-move@1": {Verifier: "complete_one_move_run", MaxActions: 60, ActionCodes: 25},
	"one-move@2": {Verifier: "complete_one_move_run", MaxActions: 4096, ActionCodes: 1026 * 1026},
	// The untimed rules with a speed bonus. Crowns' 81 is undo and 82 clears the board.
	"queens@2":      {Verifier: "complete_queens_speed_run", MaxActions: 8192, ActionCodes: 83},
	"sudoku@4":      {Verifier: "complete_sudoku_speed_run", MaxActions: 8192, ActionCodes: 810},
	"mini-sudoku@2": {Verifier: "complete_mini_sudoku_speed_run", MaxActions: 8192, ActionCodes: 360},
	// The legacy deck: sixty cells, one tap each.
	"dont-touch@1": {Verifier: "complete_dont_touch_run", MaxActions: 60, ActionCodes: 60},
}

// Lookup returns the ruleset for a rules version: its override, else its
// family's, else the fallback.
func Lookup(version string) Ruleset {
	if ruleset, ok := overrides[version]; ok {
		return ruleset
	}
	family, _, _ := strings.Cut(version, "@")
	if ruleset, ok := families[family]; ok {
		return ruleset
	}
	return fallback
}
