import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { AuthProvider } from './context/AuthContext'
import { StockProvider } from './context/StockContext'
import { RestockRunProvider } from './context/RestockRunContext'
import './styles/index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <StockProvider>
          <RestockRunProvider>
            <App />
          </RestockRunProvider>
        </StockProvider>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>,
)
