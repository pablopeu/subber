import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Editor } from './pages/Editor';
import './app.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Editor />
  </StrictMode>,
);
