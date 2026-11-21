import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../index.css';
import { getLocale } from '../i18n';
import { PublishedViewer } from './PublishedViewer';

getLocale();
createRoot(document.getElementById('root')!).render(<StrictMode><PublishedViewer /></StrictMode>);
