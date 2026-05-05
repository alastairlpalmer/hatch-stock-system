import React, { useState } from 'react';
import { cn } from '../../utils/helpers';

const PHASES = [
  { id: 'before', label: 'Before the site' },
  { id: 'vendlive', label: 'VendLive operations' },
  { id: 'wrapup', label: 'Wrap-up' },
  { id: 'reference', label: 'Reference' },
];

const STEPS = [
  {
    id: 'collect',
    number: 1,
    phase: 'before',
    title: 'Collect goods from warehouse',
    body: [
      'Arrive at the warehouse for the scheduled handover.',
      'Open the restock box and verify its contents against the pick list — confirm snacks, drinks and meals are all present. Flag anything missing before leaving.',
      'Confirm the printed Restock Plan, pick list, and planogram are inside the box.',
      'Send a WhatsApp confirmation that handover is complete.',
    ],
    videoSrc: null,
  },
  {
    id: 'transit',
    number: 2,
    phase: 'before',
    title: 'Transit to site',
    body: [
      'Use the navigation app of your choice to travel to the site address provided in your route.',
      'For exact pinpoint locations, What3Words is recommended.',
      'Aim to arrive at the target time given on your route.',
    ],
    videoSrc: null,
  },
  {
    id: 'entry',
    number: 3,
    phase: 'before',
    title: 'Site entry',
    body: [
      'Use the building intercom and state: "Hatch restocking."',
      'If there is no answer within 2 minutes, call the Hatch emergency contact before making further attempts.',
      'Carry the restock box directly to the fridge location.',
    ],
    videoSrc: null,
  },
  {
    id: 'pre-audit',
    number: 4,
    phase: 'before',
    title: 'Pre-restock audit (initial photo)',
    body: [
      'Before touching anything, take one clear photo of the fridge interior.',
      'This photo is the evidence of the pre-restock state and must be kept with the visit record.',
    ],
    videoSrc: null,
  },
  {
    id: 'login',
    number: 5,
    phase: 'vendlive',
    title: 'Log in to VendLive',
    body: [
      'Tap the top-left corner of the fridge screen to open the backend.',
      'Enter your driver credentials.',
      'If login fails, call the Hatch emergency contact — do not attempt the restock without system access.',
    ],
    videoSrc: '/videos/05-login-vendlive.mp4',
  },
  {
    id: 'check-stock',
    number: 6,
    phase: 'vendlive',
    title: 'Check existing stock in VendLive',
    body: [
      'In VendLive, go through the current stock list shown on screen.',
      'Confirm the quantities of items not due for restock this week. Update the system if there is any discrepancy between what is on screen and what is physically in the fridge.',
    ],
    videoSrc: '/videos/06-check-stock-vendlive.mp4',
  },
  {
    id: 'restock',
    number: 7,
    phase: 'vendlive',
    title: 'Restock the fridge',
    body: [
      'For every item in the restock box, complete the following in order:',
      '1. Scan the item barcode. If it will not scan, select the item manually from the on-screen list.',
      '2. Confirm the existing quantity in the fridge; update VendLive if different.',
      '3. Enter the number of units being added.',
      '4. Place the goods on the correct shelf per the printed planogram.',
      '5. Rotate stock: older units at the front, newer units behind (FIFO).',
      '6. Face all labels outward; align stock neatly so it is easy to take.',
      'Repeat for every item in the box. Do not leave any box items unplaced.',
    ],
    videoSrc: null,
  },
  {
    id: 'expiry',
    number: 8,
    phase: 'vendlive',
    title: 'Set expiry dates in VendLive',
    body: [
      'For every item added in the previous step, enter the expiry date printed on the goods.',
      'Remove and set aside any item already in the fridge that is past its expiry date, or expiring within the next 5 days (before end of week). Record SKUs and quantities of all removed items against the Restock Plan.',
      'Remove any item with damaged packaging using the same process.',
      'Note: the weekly restock cycle combined with the 5-day window should mean no expired items are found in the fridge. If expired items are present, flag this to Hatch as a rotation issue.',
    ],
    videoSrc: null,
  },
  {
    id: 'theft',
    number: 9,
    phase: 'vendlive',
    title: 'Track theft / discrepancies in VendLive',
    body: [
      'Compare what VendLive expects to be in the fridge against what is physically present.',
      'Any unexplained shortfall should be logged as shrinkage in VendLive against the relevant SKU.',
      'Flag significant or repeating discrepancies to Hatch in the WhatsApp confirmation.',
    ],
    videoSrc: null,
  },
  {
    id: 'closeout',
    number: 10,
    phase: 'vendlive',
    title: 'Close out in VendLive',
    body: [
      'Save all changes.',
      'Log out of the backend.',
      'Confirm the customer-facing planogram screen displays correctly and is not frozen or showing errors.',
      'If the screen is frozen or showing an error, call the Hatch emergency contact before leaving the site.',
    ],
    videoSrc: '/videos/10-closeout-vendlive.mp4',
  },
  {
    id: 'photo-confirm',
    number: 11,
    phase: 'vendlive',
    title: 'Photo confirmation',
    body: [
      'Close the fridge door fully.',
      'Take the following photos:',
      '• Photo 1: full fridge front, interior visible through the glass.',
      '• Photo 2: close-up of the planogram screen showing the current state.',
      '• Photo 3: the Restock Plan with updated quantities found and items removed.',
      'Send all photos to the Hatch WhatsApp and flag any issues or feedback.',
      'Wait up to 5 minutes for Hatch acknowledgement. If none is received, proceed to departure and log it in shared notes.',
    ],
    videoSrc: null,
  },
  {
    id: 'departure',
    number: 12,
    phase: 'wrapup',
    title: 'Departure and waste disposal',
    body: [
      'Leave the site once the photo confirmation is sent.',
      'Transport any expired or damaged stock back to the warehouse.',
      'Dispose of all removed stock as waste at the warehouse.',
    ],
    videoSrc: null,
  },
  {
    id: 'escalation',
    number: 13,
    phase: 'reference',
    title: 'Escalation & troubleshooting',
    body: null,
    isEscalation: true,
    videoSrc: null,
  },
];

const ESCALATION = [
  ['SKU discrepancy at pickup', 'Raise with Hatch handover contact before leaving the warehouse. Once the driver departs, missing SKUs are the driver\'s responsibility.'],
  ['No intercom response on arrival', 'Wait 2 minutes, try again, then call the Hatch emergency contact.'],
  ['VendLive login fails', 'Call the Hatch emergency contact. Do not attempt the restock without system access.'],
  ['Barcode won\'t scan', 'Select the item manually from the on-screen list. Note the SKU in the WhatsApp confirmation message.'],
  ['Expired or damaged items found', 'Remove, record SKU and quantity in the WhatsApp confirmation, transport for waste disposal at the warehouse. Flag to Hatch as a rotation issue.'],
  ['Planogram screen frozen / error after save', 'Call the Hatch emergency contact before leaving the site.'],
  ['No Hatch WhatsApp acknowledgement within 5 mins', 'Proceed with departure. Log in shared notes for Hatch to pick up.'],
  ['Unable to complete within window', 'Call the Hatch emergency contact. Partial restocks must be confirmed with Hatch before leaving.'],
];

export default function RestockingDocs() {
  const [selectedId, setSelectedId] = useState(STEPS[0].id);
  const selected = STEPS.find((s) => s.id === selectedId) ?? STEPS[0];

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm text-zinc-400">
          Step-by-step guide for the smart fridge restock process. Select a step from the list to view its instructions and video.
        </p>
      </div>

      <div className="flex flex-col md:flex-row gap-4">
        <StepIndex selectedId={selectedId} onSelect={setSelectedId} />
        <StepContent step={selected} />
      </div>
    </div>
  );
}

function StepIndex({ selectedId, onSelect }) {
  return (
    <nav className="md:w-72 flex-shrink-0 bg-zinc-900 border border-zinc-800 rounded-xl p-3 md:sticky md:top-20 md:self-start md:max-h-[calc(100vh-6rem)] md:overflow-y-auto">
      {PHASES.map((phase) => {
        const stepsInPhase = STEPS.filter((s) => s.phase === phase.id);
        if (stepsInPhase.length === 0) return null;
        return (
          <div key={phase.id} className="mb-3 last:mb-0">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 px-2 py-1.5">
              {phase.label}
            </h3>
            <ul className="space-y-0.5">
              {stepsInPhase.map((step) => {
                const isActive = step.id === selectedId;
                return (
                  <li key={step.id}>
                    <button
                      onClick={() => onSelect(step.id)}
                      className={cn(
                        'w-full text-left flex items-center gap-3 px-2.5 py-2 rounded-lg text-sm transition-all border',
                        isActive
                          ? 'bg-gradient-to-r from-emerald-600/20 to-teal-600/20 text-emerald-400 border-emerald-500/30'
                          : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50 border-transparent'
                      )}
                    >
                      <span
                        className={cn(
                          'flex-shrink-0 w-6 h-6 rounded-md flex items-center justify-center text-xs font-semibold',
                          isActive
                            ? 'bg-emerald-500/20 text-emerald-300'
                            : 'bg-zinc-800 text-zinc-500'
                        )}
                      >
                        {step.number}
                      </span>
                      <span className="truncate flex-1">{step.title}</span>
                      {step.videoSrc && (
                        <VideoBadge active={isActive} />
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}

function StepContent({ step }) {
  return (
    <article className="flex-1 bg-zinc-900 border border-zinc-800 rounded-xl p-5 md:p-6 min-w-0">
      <header className="mb-5">
        <div className="text-xs font-semibold uppercase tracking-wider text-emerald-400 mb-1">
          Step {step.number}
        </div>
        <h2 className="text-xl md:text-2xl font-semibold text-zinc-100">{step.title}</h2>
      </header>

      {step.isEscalation ? (
        <EscalationTable />
      ) : (
        <>
          {step.phase === 'vendlive' && <VideoSlot src={step.videoSrc} />}
          <div className={cn('space-y-3', step.phase === 'vendlive' && 'mt-6')}>
            {step.body.map((line, i) => (
              <p key={i} className="text-sm md:text-base text-zinc-300 leading-relaxed whitespace-pre-line">
                {line}
              </p>
            ))}
          </div>
        </>
      )}
    </article>
  );
}

function VideoSlot({ src }) {
  if (src) {
    return (
      <div className="rounded-lg overflow-hidden bg-black border border-zinc-800">
        <video
          key={src}
          src={src}
          controls
          playsInline
          className="w-full max-h-[60vh]"
        />
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-dashed border-zinc-700 bg-zinc-950/50 p-8 flex flex-col items-center justify-center text-center">
      <div className="w-12 h-12 rounded-full bg-zinc-800 flex items-center justify-center mb-3">
        <PlayIcon className="w-6 h-6 text-zinc-500" />
      </div>
      <p className="text-sm font-medium text-zinc-300">Video coming soon</p>
      <p className="text-xs text-zinc-500 mt-1">A walkthrough video will be added here.</p>
    </div>
  );
}

function EscalationTable() {
  return (
    <div className="overflow-x-auto -mx-1">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wider text-zinc-500 border-b border-zinc-800">
            <th className="px-3 py-2 font-semibold">Issue</th>
            <th className="px-3 py-2 font-semibold">Action</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-800">
          {ESCALATION.map(([issue, action]) => (
            <tr key={issue} className="align-top">
              <td className="px-3 py-3 text-zinc-200 font-medium w-2/5">{issue}</td>
              <td className="px-3 py-3 text-zinc-400 leading-relaxed">{action}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-xs text-zinc-500 mt-4 px-3">
        Do not attempt workarounds for any issue in this table without Hatch approval.
      </p>
    </div>
  );
}

function VideoBadge({ active }) {
  return (
    <span
      className={cn(
        'flex-shrink-0 inline-flex items-center justify-center w-5 h-5 rounded-full',
        active ? 'bg-emerald-500/20 text-emerald-300' : 'bg-zinc-800 text-zinc-500'
      )}
      title="Includes video"
    >
      <PlayIcon className="w-3 h-3" />
    </span>
  );
}

function PlayIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}
