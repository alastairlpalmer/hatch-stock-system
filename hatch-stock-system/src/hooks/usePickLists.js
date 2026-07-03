import { useState, useEffect } from 'react';
import { pickListsService } from '../services/pickLists.service';

// Small fail-soft fetch hook for pick lists — shared by the Dashboard's
// needs-attention rail and the Restock workflow badges. Deduplicates code,
// not requests: the consumers live on different pages, so they never
// double-fetch within one view.
export default function usePickLists(filters = {}) {
  const [lists, setLists] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const filterKey = JSON.stringify(filters);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    pickListsService.getAll(JSON.parse(filterKey))
      .then((res) => {
        if (!cancelled) setLists(Array.isArray(res) ? res : []);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err.message || 'Failed to load pick lists');
          setLists([]);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [filterKey]);

  return { lists, loading, error };
}
