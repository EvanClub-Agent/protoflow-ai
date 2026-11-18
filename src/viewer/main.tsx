import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../index.css';
import { PublishedViewer } from './PublishedViewer';

createRoot(document.getElementById('root')!).render(<StrictMode><PublishedViewer /></StrictMode>);
