// src/pages/Journal.js
import React, { useState } from 'react';
import { activeTrades, closedTrades, tradeIdeas } from '../data/trades';

const Journal = () => {
  const [activeTab, setActiveTab] = useState('active');
  
  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold mb-6">Trading Journal</h1>
      
      {/* Tabs */}
      <div className="border-b border-gray-200 mb-6">
        <nav className="flex -mb-px">
          <button
            className={`py-2 px-4 border-b-2 font-medium text-sm ${
              activeTab === 'active'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
            onClick={() => setActiveTab('active')}
          >
            Active Trades ({activeTrades.length})
          </button>
          <button
            className={`ml-8 py-2 px-4 border-b-2 font-medium text-sm ${
              activeTab === 'closed'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
            onClick={() => setActiveTab('closed')}
          >
            Closed Trades ({closedTrades.length})
          </button>
          <button
            className={`ml-8 py-2 px-4 border-b-2 font-medium text-sm ${
              activeTab === 'ideas'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
            onClick={() => setActiveTab('ideas')}
          >
            Trade Ideas ({tradeIdeas.length})
          </button>
        </nav>
      </div>
      
      {/* Active Trades Tab Content */}
      {activeTab === 'active' && (
        <div>
          {activeTrades.length > 0 ? (
            <div className="space-y-6">
              {activeTrades.map(trade => (
                <div key={trade.id} className="bg-white rounded-lg shadow p-6">
                  <div className="flex justify-between">
                    <h3 className="text-xl font-bold">{trade.title}</h3>
                    <span className={`font-bold ${trade.currentReturn >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                      {trade.currentReturn >= 0 ? '+' : ''}{trade.currentReturn}%
                    </span>
                  </div>
                  <p className="text-gray-600 mb-4">{trade.category} • Entered: {trade.date}</p>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                    <div>
                      <h4 className="font-medium mb-1">Entry Analysis</h4>
                      <p className="text-sm text-gray-700">{trade.entryAnalysis}</p>
                    </div>
                    <div>
                      <h4 className="font-medium mb-1">Strategy</h4>
                      <p className="text-sm text-gray-700">{trade.strategy}</p>
                    </div>
                    <div>
                      <h4 className="font-medium mb-1">Risk Management</h4>
                      <p className="text-sm text-gray-700">{trade.riskManagement}</p>
                    </div>
                  </div>
                  <div className="flex justify-end">
                    <button className="text-white bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded">
                      View Details
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-gray-500 text-center py-12">No active trades at the moment.</p>
          )}
        </div>
      )}
      
      {/* Closed Trades Tab Content */}
      {activeTab === 'closed' && (
        <div>
          {closedTrades.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {closedTrades.map(trade => (
                <div key={trade.id} className="bg-white rounded-lg shadow p-4">
                  <h3 className="text-lg font-bold">{trade.title}</h3>
                  <p className="text-gray-600 text-sm mb-2">{trade.entryDate} - {trade.exitDate}</p>
                  <div className="flex justify-between items-center mb-2">
                    <div>
                      <span className="text-sm text-gray-500">Entry: {trade.entry}</span>
                      <span className="text-sm text-gray-500 ml-3">Exit: {trade.exit}</span>
                    </div>
                    <span className={`font-bold ${trade.returnPercentage >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                      {trade.returnPercentage >= 0 ? '+' : ''}{trade.returnPercentage}%
                    </span>
                  </div>
                  <button className="text-blue-600 hover:text-blue-800 text-sm">
                    View details →
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-gray-500 text-center py-12">No closed trades yet.</p>
          )}
        </div>
      )}
      
      {/* Trade Ideas Tab Content */}
      {activeTab === 'ideas' && (
        <div>
          {tradeIdeas.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {tradeIdeas.map(idea => (
                <div key={idea.id} className="bg-white rounded-lg shadow p-4">
                  <div className="flex justify-between items-start">
                    <div>
                      <h3 className="text-lg font-bold">{idea.title}</h3>
                      <p className="text-gray-600 text-sm">{idea.category} • {idea.date}</p>
                    </div>
                    <span className="bg-yellow-100 text-yellow-800 text-xs px-2 py-1 rounded">
                      {idea.riskLevel} Risk
                    </span>
                  </div>
                  <p className="text-gray-700 my-3">{idea.thesis}</p>
                  <div className="flex justify-between">
                    <div>
                      <p className="text-sm text-gray-500">Entry: {idea.potentialEntry}</p>
                      <p className="text-sm text-gray-500">Timeframe: {idea.timeframe}</p>
                    </div>
                    <button className="text-blue-600 hover:text-blue-800 text-sm">
                      View analysis →
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-gray-500 text-center py-12">No trade ideas at the moment.</p>
          )}
        </div>
      )}
    </div>
  );
};

export default Journal;