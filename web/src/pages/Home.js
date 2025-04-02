// src/pages/Home.js
import React from 'react';
import { Link } from 'react-router-dom';
import { bestTrades } from '../data/trades';

const Home = () => {
  // Filter only featured trades for the homepage
  const featuredTrades = bestTrades.filter(trade => trade.featured).slice(0, 3);

  return (
    <div className="container mx-auto px-4 py-8">
      {/* Hero Section */}
      <section className="mb-20">
        <div className="bg-white rounded-xl shadow-lg p-8 mb-12">
          <div className="flex flex-col md:flex-row">
            <div className="md:w-1/2 pr-8">
              <h1 className="text-4xl font-bold mb-6">Trading Portfolio</h1>
              <p className="text-lg text-gray-600 mb-6">
                Documenting my trading journey, strategies, and insights as I navigate the financial markets.
              </p>
              <div className="flex space-x-4 mb-8">
                <div className="text-center">
                  <p className="text-3xl font-bold text-blue-600">87%</p>
                  <p className="text-sm text-gray-500">Win Rate</p>
                </div>
                <div className="text-center">
                  <p className="text-3xl font-bold text-blue-600">3.2</p>
                  <p className="text-sm text-gray-500">Risk/Reward</p>
                </div>
                <div className="text-center">
                  <p className="text-3xl font-bold text-blue-600">+28%</p>
                  <p className="text-sm text-gray-500">YTD Return</p>
                </div>
              </div>
              <div className="flex space-x-4">
                <Link 
                  to="/best-trades" 
                  className="bg-blue-900 text-white px-6 py-3 rounded-lg font-medium hover:bg-blue-800 transition"
                >
                  See Best Trades
                </Link>
                <Link 
                  to="/journal" 
                  className="px-6 py-3 rounded-lg font-medium border border-gray-300 hover:bg-gray-50 transition"
                >
                  View Journal
                </Link>
              </div>
            </div>
            <div className="md:w-1/2 mt-8 md:mt-0">
              <img 
                src="/images/dashboard.jpg" 
                alt="Trading Dashboard" 
                className="rounded-lg shadow-md"
                onError={(e) => {
                  e.target.onerror = null;
                  e.target.src = 'https://via.placeholder.com/800x450?text=Trading+Dashboard';
                }}
              />
            </div>
          </div>
        </div>
      </section>
      
      {/* About Section */}
      <section className="mb-20">
        {/* About content will go here */}
        <h2 className="text-3xl font-bold mb-4">About Me</h2>
        <p className="text-gray-700 mb-4">
          I'm a systematic trader with 5+ years of experience in equity markets, options, and futures.
        </p>
      </section>

      {/* Featured Trades */}
      <section className="mb-20">
        <div className="flex justify-between items-center mb-8">
          <h2 className="text-3xl font-bold">Featured Trades</h2>
          <Link to="/best-trades" className="text-blue-600 hover:text-blue-800 font-medium">
            View all best trades →
          </Link>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {featuredTrades.map(trade => (
            <div key={trade.id} className="bg-white rounded-xl shadow-md p-6 hover:shadow-lg transition">
              <div className="flex justify-between items-start mb-4">
                <h3 className="text-xl font-bold">{trade.title}</h3>
                <span className="text-green-500 font-bold">+{trade.returnPercentage}%</span>
              </div>
              <p className="text-gray-600 mb-4">{trade.summary || trade.thesis}</p>
              <Link to={`/best-trades#${trade.id}`} className="text-blue-600">
                View details →
              </Link>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
};

export default Home;