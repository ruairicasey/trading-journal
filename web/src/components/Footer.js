// src/components/Footer.js
import React from 'react';
import { Link } from 'react-router-dom';

const Footer = () => {
  return (
    <footer className="bg-gray-900 text-white py-12">
      <div className="container mx-auto px-4">
        <div className="flex flex-col md:flex-row justify-between">
          <div className="mb-6 md:mb-0">
            <div className="flex items-center space-x-2 mb-4">
              <span className="text-2xl text-blue-400">📈</span>
              <span className="text-xl font-bold">Trading Journal</span>
            </div>
            <p className="text-gray-400 max-w-md">
              A personal trading journal documenting my journey through the financial markets.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-8">
            <div>
              <h4 className="text-lg font-bold mb-4">Navigation</h4>
              <ul className="space-y-2">
                <li><Link to="/" className="text-gray-400 hover:text-white">Home</Link></li>
                <li><Link to="/best-trades" className="text-gray-400 hover:text-white">Best Trades</Link></li>
                <li><Link to="/journal" className="text-gray-400 hover:text-white">Trading Journal</Link></li>
              </ul>
            </div>
            <div>
              <h4 className="text-lg font-bold mb-4">Connect</h4>
              <ul className="space-y-2">
                <li><a href="#" className="text-gray-400 hover:text-white">LinkedIn</a></li>
                <li><a href="#" className="text-gray-400 hover:text-white">Twitter</a></li>
                <li><a href="#" className="text-gray-400 hover:text-white">Email</a></li>
              </ul>
            </div>
          </div>
        </div>
        <div className="border-t border-gray-800 mt-12 pt-8 flex flex-col md:flex-row justify-between items-center">
          <p className="text-gray-500 mb-4 md:mb-0">© {new Date().getFullYear()} Trading Journal. All rights reserved.</p>
          <div className="flex space-x-6">
            <a href="#" className="text-gray-500 hover:text-white">LinkedIn</a>
            <a href="#" className="text-gray-500 hover:text-white">Twitter</a>
            <a href="#" className="text-gray-500 hover:text-white">GitHub</a>
          </div>
        </div>
      </div>
    </footer>
  );
};

export default Footer;