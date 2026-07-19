import React from 'react';
import { ClipboardCheck, ListChecks, TrendingDown } from 'lucide-react';
import ActionCard from '../../ui/ActionCard';
import usePickLists from '../../../hooks/usePickLists';
import RestockPlanner from './RestockPlanner';

// The /restock home: shortcut tiles for the three working surfaces, with the
// weekly planner calendar embedded below — planning is the anchor activity,
// so it lives on the landing page rather than behind its own tab.
export default function RestockHome() {
  // Fail-soft badge: how many runs are mid-flight (or waiting to be packed).
  const { lists } = usePickLists({ limit: 20 });
  const inProgress = lists.filter((l) => l.status === 'in_progress').length;
  const drafts = lists.filter((l) => l.status === 'draft').length;
  const badge = inProgress > 0
    ? { badge: `${inProgress} in progress`, badgeTone: 'emerald' }
    : drafts > 0
      ? { badge: `${drafts} draft${drafts === 1 ? '' : 's'}`, badgeTone: 'amber' }
      : {};

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <ActionCard
          to="/restock/picklists"
          icon={ListChecks}
          title="Pick List"
          description="Pick a route, pack the bags, confirm each machine as you load it."
          {...badge}
        />
        <ActionCard
          to="/restock/check"
          icon={ClipboardCheck}
          title="Stock Check"
          description="Audit a machine — tick what matches, count what doesn't."
        />
        <ActionCard
          to="/restock/shrinkage"
          icon={TrendingDown}
          title="Shrinkage"
          description="Variance, discrepancy reasons and waste reporting."
        />
      </div>

      <RestockPlanner />
    </div>
  );
}
