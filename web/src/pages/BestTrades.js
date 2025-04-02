// src/pages/BestTrades.js
import React, { useState } from 'react';
import { bestTrades } from '../data/trades';

const BestTrades = () => {
  const [filter, setFilter] = useState('all');
  
  // Filter trades based on category
  const filteredTrades = filter === 'all' 
    ? bestTrades 
    : bestTrades.filter(trade => trade.category === filter);
  
  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold mb-6">Best Trades</h1>
      
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
          </div>
        ))}
      </div>
    </div>
  );
};

export default BestTrades;