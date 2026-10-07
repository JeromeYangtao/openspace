export const GOAL_COMMANDS = [
  '/goal',
  '/goal-status',
  '/goal-pause',
  '/goal-resume',
  '/goal-cancel',
  '/goal-update',
];
export interface GoalCommand {
  name: string;
  args: string;
  agentNames: string[];
}
export function parseGoalCommand(content: string): GoalCommand | null {
  const match =
    /^(?:(@[A-Za-z0-9_\-\u4e00-\u9fa5]+(?:\s+@[A-Za-z0-9_\-\u4e00-\u9fa5]+)*)\s+)?(\/goal(?:-[a-z]+)?)(?:\s+([\s\S]*))?$/.exec(
      content.trim(),
    );
  if (!match || !GOAL_COMMANDS.includes(match[2]!)) return null;
  const names = (match[1] ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .map((n) => n.slice(1));
  let args = (match[3] ?? '').trim();
  if (match[2] === '/goal') {
    const suffix =
      /(?:^|\s)(@[A-Za-z0-9_\-\u4e00-\u9fa5]+(?:\s+@[A-Za-z0-9_\-\u4e00-\u9fa5]+)*)$/.exec(args);
    if (suffix) {
      names.push(...suffix[1]!.split(/\s+/).map((n) => n.slice(1)));
      args = args.slice(0, suffix.index).trim();
    }
  }
  return { name: match[2]!, args, agentNames: names };
}
