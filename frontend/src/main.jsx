import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { applyTheme } from './theme.js';
import './styles.css';

applyTheme();
createRoot(document.getElementById('root')).render(<App />);
