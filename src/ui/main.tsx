import { render } from 'preact';
import { App } from './App';
import './theme.css';
import { initTheme } from './theme';

const root = document.getElementById('app');
if (!root) throw new Error('Missing #app root');
initTheme();
render(<App />, root);
