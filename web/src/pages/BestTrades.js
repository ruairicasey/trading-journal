// src/pages/BestTrades.js
import React, { useState } from 'react';
import { bestTrades } from '../data/trades';
import { useAuth } from '../context/AuthContext';
import ProtectedComponent from '../components/ProtectedComponent';

const BestTrades = () => {
  const [filter, setFilter] = useState('all');
  const { user } = useAuth();
  
  // Filter trades based on category
  const filteredTrades = filter === 'all' 
    ? bestTrades 
    : bestTrades.filter(trade => trade.category === filter);
  
  // Function to handle adding a new trade (we'll implement this in Step 2)
  const handleAddNewTrade = () => {
    // This will be implemented with the trade form
    console.log('Add new trade clicked');
  };
  
  // Function to handle editing a trade
  const handleEditTrade = (tradeId) => {
    console.log('Edit trade clicked for ID:', tradeId);
  };
  
  // Function to handle deleting a trade
  const handleDeleteTrade = (tradeId) => {
    console.log('Delete trade clicked for ID:', tradeId);
  };
  
  return (
    <div className="container mx-auto px-4 py-8">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold">Best Trades</h1>
        
        <ProtectedComponent>
          <button 
            className="px-4 py-2 bg-blue-600 text-white rounded-lg flex items-center"
            onClick={handleAddNewTrade}
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-1" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M10 5a1 1 0 011 1v3h3a1 1 0 110 2h-3v3a1 1 0 11-2 0v-3H6a1 1 0 110-2h3V6a1 1 0 011-1z" clipRule="evenodd" />
            </svg>
            Add New Trade
          </button>
        </ProtectedComponent>
      </div>
      
      {/* Filter buttons */}
      <div className="flex space-x-2 mb-6 overflow-x-auto pb-2">
        <button 
          onClick={() => setFilter('all')}
          className={`px-3 py-1 rounded ${filter === 'all' ? 'bg-blue-600 text-white' : 'bg-gray-200'}`}
        >
          All
        </button>
        <button 
          onClick={() => setFilter('stocks')}
          className={`px-3 py-1 rounded ${filter === 'stocks' ? 'bg-blue-600 text-white' : 'bg-gray-200'}`}
        >
          Stocks
        </button>
        <button 
          onClick={() => setFilter('options')}
          className={`px-3 py-1 rounded ${filter === 'options' ? 'bg-blue-600 text-white' : 'bg-gray-200'}`}
        >
          Options
        </button>
        <button 
          onClick={() => setFilter('forex')}
          className={`px-3 py-1 rounded ${filter === 'forex' ? 'bg-blue-600 text-white' : 'bg-gray-200'}`}
        >
          Forex
        </button>
        <button 
          onClick={() => setFilter('crypto')}
          className={`px-3 py-1 rounded ${filter === 'crypto' ? 'bg-blue-600 text-white' : 'bg-gray-200'}`}
        >
          Crypto
        </button>
      </div>
      
      {/* Trades grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredTrades.map(trade => (
          <div key={trade.id} className="bg-white rounded-lg shadow p-6">
            <div className="flex justify-between items-start mb-3">
              <h3 className="text-xl font-bold">{trade.title}</h3>
              <span className="text-green-500 font-bold">+{trade.returnPercentage}%</span>
            </div>
            <p className="text-gray-600 mb-3">{trade.category} • {trade.date}</p>
            <p className="text-gray-700 mb-4">{trade.summary || trade.thesis}</p>
            <div className="flex justify-between">
              <div>
                <span className="text-sm text-gray-500">Entry: {trade.entry}</span>
                <span className="text-sm text-gray-500 ml-4">Exit: {trade.exit}</span>
              </div>
              <button className="text-blue-600 hover:text-blue-800">
                View details →
              </button>
            </div>
            
            {/* Admin controls - only visible when logged in */}
            <ProtectedComponent>
              <div className="flex space-x-3 mt-4 pt-3 border-t border-gray-100">
                <button 
                  onClick={() => handleEditTrade(trade.id)}
                  className="text-sm text-blue-600 hover:text-blue-800"
                >
                  Edit
                </button>
                <button 
                  onClick={() => handleDeleteTrade(trade.id)}
                  className="text-sm text-red-600 hover:text-red-800"
                >
                  Delete
                </button>
              </div>
            </ProtectedComponent>
          </div>
        ))}
      </div>
    </div>
  );
};

export default BestTrades;