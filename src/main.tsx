import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.tsx';
import { AccountGate } from './components/AccountGate';
import { startProjectPersistence } from './services/projectStorage';
import { ProjectSaveNotice } from './components/ProjectSaveStatus';
import { ExitConfirmation } from './components/ExitConfirmation';
import { installRuntimeDiagnostics } from './services/runtimeDiagnostics';
import { DiagnosticsBoundary, RuntimeDiagnostics } from './components/RuntimeDiagnostics';
import { useProtoStore } from './store/useProtoStore';

const stopDiagnostics = installRuntimeDiagnostics(() => {
  const state=useProtoStore.getState();
  return state.isProjectClosed || state.isWelcomeScreenOpen ? {} : {projectId:state.currentProjectMeta.projectId,pageId:state.activePageId};
});
if (import.meta.hot) import.meta.hot.dispose(stopDiagnostics);
startProjectPersistence();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <DiagnosticsBoundary><AccountGate><App /></AccountGate>
    <ProjectSaveNotice />
    <ExitConfirmation /></DiagnosticsBoundary>
    <RuntimeDiagnostics />
  </StrictMode>
);
