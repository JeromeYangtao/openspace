import type { Goal, GoalReport } from '@openspace/shared';
export const REPORT_START = '<openspace-goal-report>';
export const REPORT_END = '</openspace-goal-report>';
export function visibleGoalText(text: string): string {
  return text.split(REPORT_START)[0]!.trim();
}
export function parseGoalReport(text: string, goal: Goal, iterationId: string): GoalReport {
  const index = text.lastIndexOf(REPORT_START);
  if (index < 0 || !text.trimEnd().endsWith(REPORT_END))
    throw new Error('Missing final Goal report');
  const report = JSON.parse(
    text.slice(index + REPORT_START.length, text.lastIndexOf(REPORT_END)),
  ) as GoalReport;
  if (
    report.schema_version !== 1 ||
    report.goal_id !== goal.id ||
    report.iteration_id !== iterationId ||
    report.generation !== goal.generation ||
    report.requirements_revision !== goal.requirements_revision
  )
    throw new Error('Stale or invalid report identity');
  if (
    !['continue', 'completion_candidate', 'needs_input', 'blocked'].includes(report.outcome) ||
    typeof report.summary !== 'string' ||
    !report.summary.trim() ||
    typeof report.next_action !== 'string' ||
    !Array.isArray(report.criteria)
  )
    throw new Error('Invalid Goal report');
  for (const c of report.criteria) {
    if (
      !c ||
      typeof c.id !== 'string' ||
      !['pending', 'passed', 'failed'].includes(c.state) ||
      !Array.isArray(c.evidence) ||
      c.evidence.some((e) => typeof e !== 'string' || !e.trim())
    )
      throw new Error('Invalid criterion evidence');
  }
  if (new Set(report.criteria.map((c) => c.id)).size !== report.criteria.length)
    throw new Error('Duplicate criteria');
  for (const c of goal.criteria)
    if (!report.criteria.some((r) => r.id === c.id)) throw new Error('Missing required criterion');
  if (report.criteria.some((c) => !goal.criteria.some((r) => r.id === c.id)))
    throw new Error('Unknown criterion');
  return report;
}

/** Buffer just the possible report marker suffix, so internal JSON never streams to chat. */
export class GoalTextStream {
  private pending = '';
  private hidden = false;
  push(delta: string): string {
    if (this.hidden) return '';
    this.pending += delta;
    const start = this.pending.indexOf(REPORT_START);
    if (start >= 0) {
      const visible = this.pending.slice(0, start);
      this.pending = '';
      this.hidden = true;
      return visible;
    }
    let keep = 0;
    for (let n = 1; n < REPORT_START.length; n++)
      if (this.pending.endsWith(REPORT_START.slice(0, n))) keep = n;
    const visible = this.pending.slice(0, this.pending.length - keep);
    this.pending = this.pending.slice(this.pending.length - keep);
    return visible;
  }
}
