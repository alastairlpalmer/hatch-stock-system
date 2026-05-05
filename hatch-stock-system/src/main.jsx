import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { StockProvider } from './context/StockContext'
import { RestockRunProvider } from './context/RestockRunContext'
import './styles/index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <StockProvider>
        <RestockRunProvider>
          <App />
        </RestockRunProvider>
      </StockProvider>
    </BrowserRouter>
  </React.StrictMode>,
)
