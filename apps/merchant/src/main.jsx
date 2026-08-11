import React from 'react';
import ReactDOM from 'react-dom/client';
import { installFirebaseStorage } from './firebase.js';
import MerchantApp from './App.jsx';

installFirebaseStorage();

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <MerchantApp />
  </React.StrictMode>
);