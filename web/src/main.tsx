import { createRoot } from 'react-dom/client';
import '@fontsource-variable/inter';
import './styles.css';
import { App } from './App';
import { reportClientError } from './api';

window.addEventListener('error', (e) => reportClientError(`${e.message} @ ${e.filename}:${e.lineno}`));
window.addEventListener('unhandledrejection', (e) => reportClientError(`unhandled: ${String(e.reason?.stack || e.reason)}`));

createRoot(document.getElementById('root')!).render(<App />);
