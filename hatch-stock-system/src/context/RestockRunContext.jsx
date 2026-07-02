import React, { createContext, useContext, useEffect, useState } from 'react';

const RestockRunContext = createContext(null);

// localStorage key for persisting the in-progress restock run across
// reloads/navigation (the run spans Sunday-night packing → Monday delivery).
const STORAGE_KEY = 'hatch_restock_run';

const DEFAULT_STEPS = { route: false, remove: false, machine: false };

function loadStoredRun() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        selectedRouteId: typeof parsed.selectedRouteId === 'string' ? parsed.selectedRouteId : '',
        completedSteps: { ...DEFAULT_STEPS, ...(parsed.completedSteps || {}) },
      };
    }
  } catch (e) {
    // Corrupt storage — fall through to a fresh run.
  }
  return { selectedRouteId: '', completedSteps: { ...DEFAULT_STEPS } };
}

export function RestockRunProvider({ children }) {
  // Hydrate from localStorage once (lazy initializer avoids re-reading on render).
  const [initial] = useState(loadStoredRun);
  const [selectedRouteId, setSelectedRouteId] = useState(initial.selectedRouteId);
  const [completedSteps, setCompletedSteps] = useState(initial.completedSteps);

  // Write-through persistence on every change.
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ selectedRouteId, completedSteps }));
    } catch (e) {
      // Storage full/unavailable — run continues in-memory only.
    }
  }, [selectedRouteId, completedSteps]);

  const markStepComplete = (step) => {
    setCompletedSteps((prev) => ({ ...prev, [step]: true }));
  };

  const resetRun = () => {
    setSelectedRouteId('');
    setCompletedSteps({ ...DEFAULT_STEPS });
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (e) {
      // ignore
    }
  };

  return (
    <RestockRunContext.Provider
      value={{ selectedRouteId, setSelectedRouteId, completedSteps, markStepComplete, resetRun }}
    >
      {children}
    </RestockRunContext.Provider>
  );
}

export function useRestockRun() {
  const ctx = useContext(RestockRunContext);
  if (!ctx) throw new Error('useRestockRun must be used inside RestockRunProvider');
  return ctx;
}
