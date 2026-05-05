import React, { createContext, useContext, useState } from 'react';

const RestockRunContext = createContext(null);

export function RestockRunProvider({ children }) {
  const [selectedRouteId, setSelectedRouteId] = useState('');
  const [completedSteps, setCompletedSteps] = useState({ route: false, remove: false, machine: false });

  const markStepComplete = (step) => {
    setCompletedSteps((prev) => ({ ...prev, [step]: true }));
  };

  const resetRun = () => {
    setSelectedRouteId('');
    setCompletedSteps({ route: false, remove: false, machine: false });
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
