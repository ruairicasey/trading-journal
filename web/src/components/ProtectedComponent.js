// src/components/ProtectedComponent.js
import React from 'react';
import { useAuth } from '../context/AuthContext';

// This component only renders its children when the user is logged in
const ProtectedComponent = ({ children }) => {
  const { user } = useAuth();
  
  if (!user) {
    return null;
  }
  
  return <>{children}</>;
};

export default ProtectedComponent;