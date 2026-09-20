import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import {
  ClientSideRowModelApiModule,
  HighlightChangesModule,
  ModuleRegistry,
  ValidationModule,
} from 'ag-grid-community'
import App from './App'
import './styles.css'

ModuleRegistry.registerModules([
  ClientSideRowModelApiModule,
  HighlightChangesModule,
  ...(import.meta.env.DEV ? [ValidationModule] : []),
])

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
