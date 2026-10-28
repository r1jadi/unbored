/**
 * Whether a started run would be lost if the player left the play screen.
 *
 * The play screen owns the exit control, but only the runtime knows whether a run
 * is live: each game keeps its own idea of "started", from the rules panel being
 * dismissed (One Move, 7 Second, Color Merge, Don't Touch) to the first showing
 * beat (Chain, Memory Flash) to the server's own `playing` state (Stack 10). So
 * the runtime reports, and the screen asks before leaving.
 *
 * The runtime also hands over how to end its run. Quitting a live run then ends
 * it the way the runtime's own End run does — the run is submitted, verified and
 * its score saved — instead of throwing it away.
 *
 * Reporting is deliberately one-way and additive: a runtime that mounts outside
 * the play screen — the component tests do exactly that — simply finds no
 * reporter and does nothing, rather than requiring a provider it does not need.
 */

import { createContext, useContext, useEffect } from "react";

import { RESUMABLE_RULES } from "@/lib/games/saved-runs";
import type { PlaySession } from "@/lib/games/sessions";

/**
 * The play screen's setter: `true` from the moment a run can be lost, with the
 * runtime's way to end that run and save its score, and whether the run can
 * instead be left and continued later (a signed-in player's untimed run, which
 * is saved to their account as it is played).
 */
export type RunProgressReporter = (
  active: boolean,
  endRun?: () => void,
  resumable?: boolean,
) => void;

export const RunProgressContext = createContext<RunProgressReporter | null>(null);

/**
 * What a live run's own controls need from the play screen: whether the run can
 * be left to finish later, and how to leave. Provided by the play screen; absent
 * elsewhere, where a run can only be ended.
 */
export const RunLeaveContext = createContext<{ resumable: boolean; leave: () => void } | null>(
  null,
);

/** Whether a run under this session is saved as it is played and can be continued. */
export function canFinishLater(session: PlaySession | undefined): boolean {
  return !!session && session.ranked && RESUMABLE_RULES.has(session.rulesVersion);
}

/**
 * Reports whether this runtime holds an unverified run, and how to end it, and
 * clears the report when the runtime unmounts so a stale "in progress" cannot
 * outlive it. `endRun` should be stable (a hook's callback). `session` is passed
 * by the games that can be saved and continued, so the screen can offer that.
 */
export function useReportRunProgress(
  active: boolean,
  endRun?: () => void,
  session?: PlaySession,
): void {
  const report = useContext(RunProgressContext);
  const resumable = canFinishLater(session);

  useEffect(() => {
    if (!report) return;
    report(active, active ? endRun : undefined, active && resumable);
    return () => report(false);
  }, [report, active, endRun, resumable]);
}
