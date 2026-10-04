import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import './ui/styles.css';

if (location.pathname === '/') history.replaceState(null, '', '/play' + location.search);
createRoot(document.getElementById('root')!).render(<App />);
