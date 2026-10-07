export type GoalStatus =
  | 'queued'
  | 'running'
  | 'verifying'
  | 'awaiting_input'
  | 'awaiting_approval'
  | 'pausing'
  | 'paused'
  | 'cancelling'
  | 'completed'
  | 'cancelled'
  | 'failed';
export interface GoalCriterion {
  id: string;
  text: string;
  state: 'pending' | 'passed' | 'failed';
  evidence: string[];
}
export interface Goal {
  id: string;
  channel_id: string;
  thread_root_id: string;
  agent_id: string;
  created_by: string;
  objective: string;
  requirements: string[];
  criteria: GoalCriterion[];
  status: GoalStatus;
  reason: string | null;
  summary: string;
  version: number;
  generation: number;
  requirements_revision: number;
  rounds_used: number;
  max_rounds: number;
  active_ms: number;
  max_active_ms: number;
  no_progress: number;
  invalid_reports: number;
  created_at: number;
  updated_at: number;
}
export type GoalAction = 'pause' | 'resume' | 'cancel' | 'update' | 'confirm';
export interface GoalReport {
  schema_version: 1;
  goal_id: string;
  iteration_id: string;
  generation: number;
  requirements_revision: number;
  outcome: 'continue' | 'completion_candidate' | 'needs_input' | 'blocked';
  summary: string;
  next_action: string;
  criteria: GoalCriterion[];
}
