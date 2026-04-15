import React, { useState } from 'react';

type Workflow = { id: string; name: string };

export function App(): JSX.Element {
  const [workflow, setWorkflow] = useState<Workflow>({ id: 'w_1', name: 'Primary' });
  const [enabled, setEnabled] = useState(false);

  function handleCreateWorkflow(): void {
    setWorkflow((prev) => ({ ...prev, name: prev.name + '!' }));
  }

  function handleToggleNotifications(): void {
    setEnabled((prev) => !prev);
  }

  return (
    <div>
      <button onClick={handleCreateWorkflow}>Create Workflow</button>
      <button aria-label="Enable Notifications" onClick={handleToggleNotifications}>
        Toggle
      </button>
      <div>{workflow.name}</div>
      <div>{String(enabled)}</div>
    </div>
  );
}

