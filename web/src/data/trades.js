// Sample trade data for the trading journal
export const bestTrades = [
    {
      id: 'aapl-earnings',
      title: 'AAPL Q4 Earnings Play',
      category: 'options',
      date: 'January 28, 2024',
      returnPercentage: 218,
      entry: '$187.5',
      exit: '$205.8',
      duration: '12 Days',
      image: '/images/charts/aapl-chart-large.jpg',
      featured: true,
      thesis: 'Anticipated strong iPhone sales in China based on channel checks and positive App Store growth metrics. Sentiment was overly pessimistic following previous quarter\'s guidance, creating asymmetric opportunity.',
      execution: 'Purchased Feb 18 $190 call options two weeks before earnings at $4.85 per contract. Used a 3% position size with defined risk. Added to position when AAPL bounced off 50-day moving average.',
      insights: [
        'Position timing was critical - waited for technical confirmation pattern',
        'Asymmetric risk/reward - limited downside with substantial upside potential',
        'Managed position size appropriately for earnings volatility'
      ]
    },
    {
      id: 'eurusd-reversal',
      title: 'EUR/USD Reversal',
      category: 'forex',
      date: 'March 15, 2024',
      returnPercentage: 87,
      entry: '1.0685',
      exit: '1.0925',
      duration: '18 Days',
      image: '/images/charts/eurusd-chart.jpg',
      featured: true,
      summary: 'Identified key support level with RSI divergence. Entered long position after confirmation candle with tight stop loss.',
      strategy: 'This trade was based on identifying a key technical support level where the EUR/USD had previously found strong buying interest. The RSI indicator showed positive divergence (price making lower lows while RSI formed higher lows), suggesting weakening downside momentum.',
      riskManagement: 'Position sized at 5% of portfolio with stop loss placed below the support zone at 1.0610 (0.7% risk). Used a risk-reward ratio of 1:3 with initial profit target at 1.0850. When price reached this level, moved stop loss to breakeven and let remaining position run to 1.0925.'
    },
    // Add more best trades...
  ];
  
  export const activeTrades = [
    {
      id: 'msft-long',
      title: 'MSFT Long Position',
      category: 'stocks',
      date: 'March 25, 2025',
      currentReturn: 12.8,
      entry: '$400.5',
      currentPrice: '$451.7',
      duration: '6 Days',
      image: '/images/charts/msft-chart.jpg',
      entryAnalysis: 'Entered after cloud services revenue beat expectations. Technical consolidation around $400 with strong support.',
      strategy: 'Swing trade with 3-week outlook. Initial position sizing at 5% of portfolio with planned add at support level.',
      riskManagement: 'Stop loss at $385 (-3.8%). Partial profit take planned at $430 (+7.5%) with trailing stop after.'
    },
    // Add more active trades...
  ];
  
  export const closedTrades = [
    {
      id: 'amd-swing',
      title: 'AMD Swing Trade',
      category: 'stocks',
      entryDate: 'December 10, 2023',
      exitDate: 'January 15, 2024',
      returnPercentage: 28.5,
      entry: '$123.45',
      exit: '$158.65',
      duration: '36 Days',
      image: '/images/charts/amd-chart.jpg'
    },
    // Add more closed trades...
  ];
  
  export const tradeIdeas = [
    {
      id: 'nvda-earnings',
      title: 'NVDA Earnings Setup',
      category: 'options',
      date: 'March 30, 2025',
      image: '/images/charts/nvda-chart.jpg',
      thesis: 'Looking for potential bullish setup ahead of next earnings with AI demand remaining strong. Monitoring for consolidation pattern completion.',
      potentialEntry: '$875-$900 range',
      riskLevel: 'Moderate',
      timeframe: '3-4 weeks'
    },
    // Add more trade ideas...
  ];