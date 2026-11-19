export type FunnelStageRef = { id: string; name: string; order: number };
export type FunnelMovementActivity = { dealId: string | null; body: string | null };
export type FunnelMovementCounts = Record<string, { advanced: number }>;

function escapeRegExp(value: string) {
  return value.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
}

function stageTransition(body: string, stages: FunnelStageRef[]) {
  const ordered = [...stages].sort((a, b) => b.name.length - a.name.length);

  for (const from of ordered) {
    const prefix = `moveu o negócio de ${from.name} para `;
    if (!body.startsWith(prefix)) continue;
    const targetText = body.slice(prefix.length);
    const to = ordered.find((stage) => {
      if (!targetText.startsWith(stage.name)) return false;
      const suffix = targetText.slice(stage.name.length);
      return suffix === "" || suffix.startsWith(" ·") || suffix.startsWith(" (ação em massa)");
    });
    if (to) return { from, to };
  }

  const idTransition = body.match(/etapa\s+([^\s→]+)\s*→\s*([^\s.]+)/);
  if (idTransition) {
    const from = stages.find((stage) => stage.id === idTransition[1]);
    const to = stages.find((stage) => stage.id === idTransition[2]);
    if (from && to) return { from, to };
  }

  if (body.startsWith("moveu o negócio do funil ")) {
    for (const from of ordered) {
      for (const to of ordered) {
        const pattern = new RegExp(`\\(${escapeRegExp(from.name)}\\) para .+ \\(${escapeRegExp(to.name)}\\)(?: ·|$)`);
        if (pattern.test(body)) return { from, to };
      }
    }
  }

  return null;
}

/** Counts distinct deals with a recorded move out of each stage. */
export function aggregateFunnelMovements(
  stages: FunnelStageRef[],
  activities: FunnelMovementActivity[],
): FunnelMovementCounts {
  const advancedByStage = new Map<string, Set<string>>();

  for (const activity of activities) {
    if (!activity.dealId || !activity.body) continue;
    const transition = stageTransition(activity.body, stages);
    if (!transition || transition.from.id === transition.to.id) continue;

    if (transition.to.order > transition.from.order) {
      const advanced = advancedByStage.get(transition.from.id) ?? new Set<string>();
      advanced.add(activity.dealId);
      advancedByStage.set(transition.from.id, advanced);
    }
  }

  return Object.fromEntries(stages.map((stage) => [stage.id, {
    advanced: advancedByStage.get(stage.id)?.size ?? 0,
  }]));
}
