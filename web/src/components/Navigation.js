import React from 'react';
import { Link, NavLink } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const Navigation = () => {
  const { user, logout } = useAuth();

  return (
    <header className="bg-blue-900 text-white shadow-md">
      <div className="container mx-auto px-4">
        <div className="flex justify-between items-center py-4">
          <div className="flex items-center space-x-2">
            <span className="text-2xl text-blue-400">📈</span>
            <Link to="/" className="text-xl font-bold">Trading Journal</Link>
          </div>
          
          <nav className="hidden md:flex space-x-8">
            <NavLink 
              to="/" 
              className={({ isActive }) => 
                isActive ? "py-2 px-1 border-b-2 border-blue-500" : "py-2 px-1 hover:text-blue-300"
              }
              end
            >
              Home
            </NavLink>
            <NavLink 
              to="/best-trades" 
              className={({ isActive }) => 
                isActive ? "py-2 px-1 border-b-2 border-blue-500" : "py-2 px-1 hover:text-blue-300"
              }
            >
              Best Trades
            </NavLink>
            <NavLink 
              to="/journal" 
              className={({ isActive }) => 
                isActive ? "py-2 px-1 border-b-2 border-blue-500" : "py-2 px-1 hover:text-blue-300"
              }
            >
              Trading Journal
            </NavLink>
          </nav>
          
          <div>
            {user ? (
              <button 
                onClick={logout}
                className="px-4 py-2 rounded bg-red-500 hover:bg-red-600 transition"
              >
                Logout
              </button>
            ) : (
              <button 
                onClick={() => document.getElementById('login-modal').showModal()}
                className="px-4 py-2 rounded bg-blue-500 hover:bg-blue-600 transition"
              >
                Login
              </button>
            )}
          </div>
        </div>
      </div>
    </header>
  );
};

export default Navigation;