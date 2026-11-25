import { render } from 'preact';
import { App } from './App';
import './theme.css';
import { initTheme } from './theme';
import { KitPage } from './kit/KitPage';

const root = document.getElementById('app');
if (!root) throw new Error('Missing #app root');
initTheme();
// `?kit` opens the primitives test page of design revision 6 (task R6-02) instead of the game.
render(new URLSearchParams(location.search).has('kit') ? <KitPage /> : <App />, root);
