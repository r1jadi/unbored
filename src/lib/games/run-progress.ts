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

/**
 * The play screen's setter: `true` from the moment a run can be lost, with the
 * runtime's way to end that run and save its score.
 */
export type RunProgressReporter = (active: boolean, endRun?: () => void) => void;

export const RunProgressContext = createContext<RunProgressReporter | null>(null);

/**
 * Reports whether this runtime holds an unverified run, and how to end it, and
 * clears the report when the runtime unmounts so a stale "in progress" cannot
 * outlive it. `endRun` should be stable (a hook's callback).
 */
export function useReportRunProgress(active: boolean, endRun?: () => void): void {
  const report = useContext(RunProgressContext);

  useEffect(() => {
    if (!report) return;
    report(active, active ? endRun : undefined);
    return () => report(false);
  }, [report, active, endRun]);
}
