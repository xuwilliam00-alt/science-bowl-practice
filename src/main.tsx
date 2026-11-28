import { createRoot } from 'react-dom/client'
import App from './App'
import Gate from './Gate'
import { DialogHost } from './dialog'
import { Boundary } from './boundary'
import { MemeHost } from './memes'
import { loadShared, startTheme } from './platform'
import './styles.css'
import './design.css'
startTheme()
// No StrictMode: match timers/rooms start in effects and must run once.
loadShared().finally(() => createRoot(document.getElementById('root')!).render(<Gate><Boundary><App /></Boundary><DialogHost /><MemeHost /></Gate>))
