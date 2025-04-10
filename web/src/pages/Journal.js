// src/pages/Journal.js
import React, { useState } from 'react';
import { activeTrades, closedTrades, tradeIdeas } from '../data/trades';
import { useAuth } from '../context/AuthContext';
import ProtectedComponent from '../components/ProtectedComponent';

const Journal = () => {
  const [activeTab, setActiveTab] = useState('active');
  const { user } = useAuth();
  
  // Function to handle adding a new active trade
  const handleAddActiveTrade = () => {
    console.log('Add new active trade clicked');
  };

  // Function to handle adding a closed trade
  const handleAddClosedTrade = () => {
    console.log('Add new closed trade clicked');
  };

  // Function to handle adding a trade idea
  const handleAddTradeIdea = () => {
    console.log('Add new trade idea clicked');
  };
  
  // Functions to handle edit/delete
  const handleEditTrade = (tradeId) => {
    console.log('Edit trade clicked for ID:', tradeId);
  };
  
  const handleDeleteTrade = (tradeId) => {
    console.log('Delete trade clicked for ID:', tradeId);
  };
  
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
          <ProtectedComponent>
            <div className="flex justify-end mb-4">
              <button 
                onClick={handleAddActiveTrade}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg flex items-center"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-1" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M10 5a1 1 0 011 1v3h3a1 1 0 110 2h-3v3a1 1 0 11-2 0v-3H6a1 1 0 110-2h3V6a1 1 0 011-1z" clipRule="evenodd" />
                </svg>
                Add Active Trade
              </button>
            </div>
          </ProtectedComponent>
          
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
                  <div className="flex justify-between items-center">
                    <button className="text-blue-600 hover:text-blue-800">
                      View Details →
                    </button>
                    
                    <ProtectedComponent>
                      <div className="flex space-x-3">
                        <button 
                          onClick={() => handleEditTrade(trade.id)}
                          className="text-white bg-blue-600 hover:bg-blue-700 px-3 py-1 rounded text-sm"
                        >
                          Edit
                        </button>
                        <button 
                          onClick={() => handleDeleteTrade(trade.id)}
                          className="text-white bg-red-600 hover:bg-red-700 px-3 py-1 rounded text-sm"
                        >
                          Delete
                        </button>
                      </div>
                    </ProtectedComponent>
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
          <ProtectedComponent>
            <div className="flex justify-end mb-4">
              <button 
                onClick={handleAddClosedTrade}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg flex items-center"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-1" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M10 5a1 1 0 011 1v3h3a1 1 0 110 2h-3v3a1 1 0 11-2 0v-3H6a1 1 0 110-2h3V6a1 1 0 011-1z" clipRule="evenodd" />
                </svg>
                Add Closed Trade
              </button>
            </div>
          </ProtectedComponent>
          
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
                  <div className="flex justify-between items-center">
                    <button className="text-blue-600 hover:text-blue-800 text-sm">
                      View details →
                    </button>
                    
                    <ProtectedComponent>
                      <div className="flex space-x-2">
                        <button 
                          onClick={() => handleEditTrade(trade.id)}
                          className="text-blue-600 hover:text-blue-800 text-sm"
                        >
                          Edit
                        </button>
                        <button 
                          onClick={() => handleDeleteTrade(trade.id)}
                          className="text-red-600 hover:text-red-800 text-sm"
                        >
                          Delete
                        </button>
                      </div>
                    </ProtectedComponent>
                  </div>
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
          <ProtectedComponent>
            <div className="flex justify-end mb-4">
              <button 
                onClick={handleAddTradeIdea}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg flex items-center"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-1" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M10 5a1 1 0 011 1v3h3a1 1 0 110 2h-3v3a1 1 0 11-2 0v-3H6a1 1 0 110-2h3V6a1 1 0 011-1z" clipRule="evenodd" />
                </svg>
                Add Trade Idea
              </button>
            </div>
          </ProtectedComponent>
          
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
                    <div className="flex items-center">
                      <button className="text-blue-600 hover:text-blue-800 text-sm">
                        View analysis →
                      </button>
                      
                      <ProtectedComponent>
                        <div className="flex space-x-2 ml-4">
                          <button 
                            onClick={() => handleEditTrade(idea.id)}
                            className="text-blue-600 hover:text-blue-800 text-sm"
                          >
                            Edit
                          </button>
                          <button 
                            onClick={() => handleDeleteTrade(idea.id)}
                            className="text-red-600 hover:text-red-800 text-sm"
                          >
                            Delete
                          </button>
                        </div>
                      </ProtectedComponent>
                    </div>
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