import React from 'react';

export default function HatchLogo({ collapsed }) {
  if (collapsed) {
    return (
      <img
        src="/brand/hatch-icon-cream.svg"
        alt="Hatch"
        className="h-9 w-auto flex-shrink-0"
      />
    );
  }

  return (
    <img
      src="/brand/hatch-horizontal-cream.svg"
      alt="Hatch"
      className="h-8 w-auto"
    />
  );
}
