import React, { useState, useEffect } from 'react';
import { BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, AreaChart, Area } from 'recharts';
import { Activity, TrendingUp, Users, DollarSign, Database, ArrowUpRight, ArrowDownRight, Menu, X, LayoutDashboard, LineChart as LineChartIcon, Settings, Bell } from 'lucide-react';

// Mock data generator for AWS streaming data
const generateMockData = () => {
  const monthlyData = [
    { month: 'Jan', revenue: 45000, users: 2400, sessions: 18000, conversions: 340 },
    { month: 'Feb', revenue: 52000, users: 2800, sessions: 21000, conversions: 410 },
    { month: 'Mar', revenue: 48000, users: 2600, sessions: 19500, conversions: 380 },
    { month: 'Apr', revenue: 61000, users: 3200, sessions: 24000, conversions: 480 },
    { month: 'May', revenue: 58000, users: 3100, sessions: 23000, conversions: 450 },
    { month: 'Jun', revenue: 67000, users: 3600, sessions: 27000, conversions: 520 },
  ];

  const realTimeData = Array.from({ length: 20 }, (_, i) => ({
    time: `${i}m`,
    requests: Math.floor(Math.random() * 100) + 50,
    errors: Math.floor(Math.random() * 10),
  }));

  const trafficSources = [
    { name: 'Direct', value: 4200, color: '#0a0a0a' },
    { name: 'Organic', value: 3800, color: '#2a2a2a' },
    { name: 'Referral', value: 2100, color: '#4a4a4a' },
    { name: 'Social', value: 1800, color: '#6a6a6a' },
    { name: 'Email', value: 1200, color: '#8a8a8a' },
  ];

  const regionData = [
    { region: 'North America', users: 5200, revenue: 125000 },
    { region: 'Europe', users: 4100, revenue: 98000 },
    { region: 'Asia Pacific', users: 6800, revenue: 142000 },
    { region: 'Latin America', users: 2400, revenue: 52000 },
    { region: 'Middle East', users: 1800, revenue: 41000 },
  ];

  return { monthlyData, realTimeData, trafficSources, regionData };
};

const AnalyticsDashboard = () => {
  const [activePage, setActivePage] = useState('overview');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [data, setData] = useState(generateMockData());
  const [isStreaming, setIsStreaming] = useState(true);

  // Simulate real-time data streaming
  useEffect(() => {
    if (!isStreaming) return;
    
    const interval = setInterval(() => {
      setData(prev => ({
        ...prev,
        realTimeData: prev.realTimeData.map(item => ({
          ...item,
          requests: Math.floor(Math.random() * 100) + 50,
          errors: Math.floor(Math.random() * 10),
        }))
      }));
    }, 3000);

    return () => clearInterval(interval);
  }, [isStreaming]);

  // Stats Card Component
  const StatCard = ({ icon: Icon, title, value, change, trend }) => (
    <div className="stat-card">
      <div className="stat-header">
        <div className="stat-icon">
          <Icon size={20} />
        </div>
        <span className="stat-title">{title}</span>
      </div>
      <div className="stat-value">{value}</div>
      <div className={`stat-change ${trend}`}>
        {trend === 'up' ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
        <span>{change}</span>
      </div>
    </div>
  );

  // Sidebar Component
  const Sidebar = () => (
    <aside className={`sidebar ${sidebarOpen ? 'open' : 'closed'}`}>
      <div className="sidebar-header">
        <h1 className="logo">Analytics</h1>
      </div>
      
      <nav className="sidebar-nav">
        <button 
          className={`nav-item ${activePage === 'overview' ? 'active' : ''}`}
          onClick={() => setActivePage('overview')}
        >
          <LayoutDashboard size={20} />
          {sidebarOpen && <span>Overview</span>}
        </button>
        
        <button 
          className={`nav-item ${activePage === 'analytics' ? 'active' : ''}`}
          onClick={() => setActivePage('analytics')}
        >
          <LineChartIcon size={20} />
          {sidebarOpen && <span>Analytics</span>}
        </button>
        
        <button 
          className={`nav-item ${activePage === 'realtime' ? 'active' : ''}`}
          onClick={() => setActivePage('realtime')}
        >
          <Activity size={20} />
          {sidebarOpen && <span>Real-time</span>}
        </button>
        
        <button 
          className={`nav-item ${activePage === 'settings' ? 'active' : ''}`}
          onClick={() => setActivePage('settings')}
        >
          <Settings size={20} />
          {sidebarOpen && <span>Settings</span>}
        </button>
      </nav>
    </aside>
  );

  // Overview Page
  const OverviewPage = () => (
    <div className="page-content">
      <div className="page-header">
        <div>
          <h2 className="page-title">Overview</h2>
          <p className="page-subtitle">Key metrics and insights at a glance</p>
        </div>
        <button className="streaming-badge" onClick={() => setIsStreaming(!isStreaming)}>
          <div className={`streaming-dot ${isStreaming ? 'active' : ''}`} />
          {isStreaming ? 'Live' : 'Paused'}
        </button>
      </div>

      <div className="stats-grid">
        <StatCard 
          icon={DollarSign} 
          title="Total Revenue" 
          value="$331K" 
          change="+12.5% from last month"
          trend="up"
        />
        <StatCard 
          icon={Users} 
          title="Active Users" 
          value="17.9K" 
          change="+8.2% from last month"
          trend="up"
        />
        <StatCard 
          icon={Activity} 
          title="Sessions" 
          value="132.5K" 
          change="+15.3% from last month"
          trend="up"
        />
        <StatCard 
          icon={TrendingUp} 
          title="Conversion Rate" 
          value="2.4%" 
          change="-0.3% from last month"
          trend="down"
        />
      </div>

      <div className="charts-row">
        <div className="chart-card large">
          <h3 className="chart-title">Revenue Trend</h3>
          <ResponsiveContainer width="100%" height={300}>
            <AreaChart data={data.monthlyData}>
              <defs>
                <linearGradient id="revenueGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#0a0a0a" stopOpacity={0.3}/>
                  <stop offset="95%" stopColor="#0a0a0a" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e5e5" />
              <XAxis dataKey="month" stroke="#666" />
              <YAxis stroke="#666" />
              <Tooltip 
                contentStyle={{ 
                  backgroundColor: '#fff', 
                  border: '1px solid #e5e5e5',
                  borderRadius: '8px'
                }} 
              />
              <Area 
                type="monotone" 
                dataKey="revenue" 
                stroke="#0a0a0a" 
                strokeWidth={2}
                fill="url(#revenueGradient)" 
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="chart-card">
          <h3 className="chart-title">Traffic Sources</h3>
          <ResponsiveContainer width="100%" height={300}>
            <PieChart>
              <Pie
                data={data.trafficSources}
                cx="50%"
                cy="50%"
                innerRadius={60}
                outerRadius={100}
                paddingAngle={2}
                dataKey="value"
              >
                {data.trafficSources.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
          <div className="legend-custom">
            {data.trafficSources.map((source, idx) => (
              <div key={idx} className="legend-item">
                <div className="legend-color" style={{ backgroundColor: source.color }} />
                <span>{source.name}</span>
                <span className="legend-value">{source.value.toLocaleString()}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );

  // Analytics Page
  const AnalyticsPage = () => (
    <div className="page-content">
      <div className="page-header">
        <div>
          <h2 className="page-title">Analytics</h2>
          <p className="page-subtitle">Deep dive into your metrics</p>
        </div>
      </div>

      <div className="charts-row">
        <div className="chart-card large">
          <h3 className="chart-title">User Growth</h3>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={data.monthlyData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e5e5" />
              <XAxis dataKey="month" stroke="#666" />
              <YAxis stroke="#666" />
              <Tooltip 
                contentStyle={{ 
                  backgroundColor: '#fff', 
                  border: '1px solid #e5e5e5',
                  borderRadius: '8px'
                }} 
              />
              <Line 
                type="monotone" 
                dataKey="users" 
                stroke="#0a0a0a" 
                strokeWidth={2}
                dot={{ fill: '#0a0a0a', r: 4 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="chart-card large">
          <h3 className="chart-title">Sessions & Conversions</h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={data.monthlyData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e5e5" />
              <XAxis dataKey="month" stroke="#666" />
              <YAxis stroke="#666" />
              <Tooltip 
                contentStyle={{ 
                  backgroundColor: '#fff', 
                  border: '1px solid #e5e5e5',
                  borderRadius: '8px'
                }} 
              />
              <Bar dataKey="sessions" fill="#4a4a4a" radius={[4, 4, 0, 0]} />
              <Bar dataKey="conversions" fill="#0a0a0a" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="table-card">
        <h3 className="chart-title">Regional Performance</h3>
        <table className="data-table">
          <thead>
            <tr>
              <th>Region</th>
              <th>Users</th>
              <th>Revenue</th>
              <th>Avg. Revenue/User</th>
            </tr>
          </thead>
          <tbody>
            {data.regionData.map((region, idx) => (
              <tr key={idx}>
                <td><strong>{region.region}</strong></td>
                <td>{region.users.toLocaleString()}</td>
                <td>${region.revenue.toLocaleString()}</td>
                <td>${Math.round(region.revenue / region.users)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );

  // Real-time Page
  const RealTimePage = () => (
    <div className="page-content">
      <div className="page-header">
        <div>
          <h2 className="page-title">Real-time</h2>
          <p className="page-subtitle">Live data streaming from AWS</p>
        </div>
        <div className="streaming-badge active">
          <div className="streaming-dot active" />
          Streaming
        </div>
      </div>

      <div className="stats-grid">
        <StatCard 
          icon={Database} 
          title="Active Connections" 
          value="1,247" 
          change="Live"
          trend="up"
        />
        <StatCard 
          icon={Activity} 
          title="Requests/Min" 
          value="3,842" 
          change="Live"
          trend="up"
        />
      </div>

      <div className="chart-card large">
        <h3 className="chart-title">Request Volume</h3>
        <ResponsiveContainer width="100%" height={350}>
          <LineChart data={data.realTimeData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e5e5" />
            <XAxis dataKey="time" stroke="#666" />
            <YAxis stroke="#666" />
            <Tooltip 
              contentStyle={{ 
                backgroundColor: '#fff', 
                border: '1px solid #e5e5e5',
                borderRadius: '8px'
              }} 
            />
            <Line 
              type="monotone" 
              dataKey="requests" 
              stroke="#0a0a0a" 
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
            <Line 
              type="monotone" 
              dataKey="errors" 
              stroke="#dc2626" 
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );

  // Settings Page
  const SettingsPage = () => (
    <div className="page-content">
      <div className="page-header">
        <div>
          <h2 className="page-title">Settings</h2>
          <p className="page-subtitle">Configure your analytics platform</p>
        </div>
      </div>

      <div className="settings-section">
        <h3 className="settings-title">AWS Configuration</h3>
        <div className="setting-item">
          <label>Region</label>
          <select className="setting-input">
            <option>us-east-1</option>
            <option>us-west-2</option>
            <option>eu-west-1</option>
          </select>
        </div>
        <div className="setting-item">
          <label>Stream Name</label>
          <input className="setting-input" type="text" placeholder="analytics-stream" />
        </div>
        <div className="setting-item">
          <label>Refresh Interval (seconds)</label>
          <input className="setting-input" type="number" placeholder="3" />
        </div>
      </div>

      <div className="settings-section">
        <h3 className="settings-title">Notifications</h3>
        <div className="setting-item toggle">
          <label>Enable real-time alerts</label>
          <input type="checkbox" defaultChecked />
        </div>
        <div className="setting-item toggle">
          <label>Email daily reports</label>
          <input type="checkbox" />
        </div>
      </div>

      <button className="save-button">Save Changes</button>
    </div>
  );

  return (
    <div className="dashboard">
      <Sidebar />
      
      <main className="main-content">
        <header className="top-bar">
          <button 
            className="menu-toggle"
            onClick={() => setSidebarOpen(!sidebarOpen)}
          >
            {sidebarOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
          
          <div className="top-bar-right">
            <button className="icon-button">
              <Bell size={20} />
            </button>
            <div className="user-avatar">AM</div>
          </div>
        </header>

        {activePage === 'overview' && <OverviewPage />}
        {activePage === 'analytics' && <AnalyticsPage />}
        {activePage === 'realtime' && <RealTimePage />}
        {activePage === 'settings' && <SettingsPage />}
      </main>

      <style>{`
        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }

        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
          background: #fafafa;
          color: #0a0a0a;
        }

        .dashboard {
          display: flex;
          min-height: 100vh;
        }

        /* Sidebar */
        .sidebar {
          width: 240px;
          background: #fff;
          border-right: 1px solid #e5e5e5;
          display: flex;
          flex-direction: column;
          transition: width 0.3s ease;
          position: fixed;
          height: 100vh;
          z-index: 100;
        }

        .sidebar.closed {
          width: 70px;
        }

        .sidebar-header {
          padding: 24px;
          border-bottom: 1px solid #e5e5e5;
        }

        .logo {
          font-size: 20px;
          font-weight: 600;
          letter-spacing: -0.5px;
        }

        .sidebar.closed .logo {
          font-size: 16px;
        }

        .sidebar-nav {
          padding: 16px;
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .nav-item {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 12px 16px;
          border: none;
          background: transparent;
          color: #666;
          cursor: pointer;
          border-radius: 8px;
          transition: all 0.2s;
          font-size: 14px;
          text-align: left;
          width: 100%;
        }

        .nav-item:hover {
          background: #f5f5f5;
          color: #0a0a0a;
        }

        .nav-item.active {
          background: #0a0a0a;
          color: #fff;
        }

        .sidebar.closed .nav-item {
          justify-content: center;
        }

        .sidebar.closed .nav-item span {
          display: none;
        }

        /* Main Content */
        .main-content {
          flex: 1;
          margin-left: 240px;
          transition: margin-left 0.3s ease;
        }

        .sidebar.closed ~ .main-content {
          margin-left: 70px;
        }

        .top-bar {
          height: 70px;
          background: #fff;
          border-bottom: 1px solid #e5e5e5;
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0 32px;
          position: sticky;
          top: 0;
          z-index: 50;
        }

        .menu-toggle {
          border: none;
          background: transparent;
          cursor: pointer;
          padding: 8px;
          border-radius: 6px;
          display: flex;
          align-items: center;
          justify-content: center;
          color: #666;
        }

        .menu-toggle:hover {
          background: #f5f5f5;
        }

        .top-bar-right {
          display: flex;
          align-items: center;
          gap: 16px;
        }

        .icon-button {
          border: none;
          background: transparent;
          cursor: pointer;
          padding: 8px;
          border-radius: 6px;
          display: flex;
          align-items: center;
          justify-content: center;
          color: #666;
        }

        .icon-button:hover {
          background: #f5f5f5;
        }

        .user-avatar {
          width: 36px;
          height: 36px;
          border-radius: 50%;
          background: #0a0a0a;
          color: #fff;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 14px;
          font-weight: 600;
        }

        /* Page Content */
        .page-content {
          padding: 32px;
          max-width: 1400px;
        }

        .page-header {
          margin-bottom: 32px;
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
        }

        .page-title {
          font-size: 28px;
          font-weight: 600;
          margin-bottom: 4px;
          letter-spacing: -0.5px;
        }

        .page-subtitle {
          color: #666;
          font-size: 14px;
        }

        .streaming-badge {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 8px 16px;
          background: #f5f5f5;
          border: 1px solid #e5e5e5;
          border-radius: 20px;
          font-size: 13px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s;
        }

        .streaming-badge:hover {
          background: #ececec;
        }

        .streaming-badge.active {
          background: #0a0a0a;
          color: #fff;
          border-color: #0a0a0a;
        }

        .streaming-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: #666;
        }

        .streaming-dot.active {
          background: #22c55e;
          animation: pulse 2s infinite;
        }

        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }

        /* Stats Grid */
        .stats-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
          gap: 20px;
          margin-bottom: 32px;
        }

        .stat-card {
          background: #fff;
          border: 1px solid #e5e5e5;
          border-radius: 12px;
          padding: 20px;
          transition: all 0.2s;
        }

        .stat-card:hover {
          border-color: #d4d4d4;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
        }

        .stat-header {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 16px;
        }

        .stat-icon {
          width: 32px;
          height: 32px;
          background: #f5f5f5;
          border-radius: 8px;
          display: flex;
          align-items: center;
          justify-content: center;
          color: #0a0a0a;
        }

        .stat-title {
          font-size: 13px;
          color: #666;
          font-weight: 500;
        }

        .stat-value {
          font-size: 28px;
          font-weight: 600;
          margin-bottom: 8px;
          letter-spacing: -0.5px;
        }

        .stat-change {
          display: flex;
          align-items: center;
          gap: 4px;
          font-size: 13px;
          color: #666;
        }

        .stat-change.up {
          color: #22c55e;
        }

        .stat-change.down {
          color: #dc2626;
        }

        /* Charts */
        .charts-row {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(400px, 1fr));
          gap: 20px;
          margin-bottom: 32px;
        }

        .chart-card {
          background: #fff;
          border: 1px solid #e5e5e5;
          border-radius: 12px;
          padding: 24px;
        }

        .chart-card.large {
          grid-column: span 2;
        }

        @media (max-width: 1200px) {
          .chart-card.large {
            grid-column: span 1;
          }
        }

        .chart-title {
          font-size: 16px;
          font-weight: 600;
          margin-bottom: 20px;
        }

        .legend-custom {
          margin-top: 20px;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .legend-item {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 13px;
        }

        .legend-color {
          width: 12px;
          height: 12px;
          border-radius: 2px;
        }

        .legend-value {
          margin-left: auto;
          font-weight: 600;
        }

        /* Table */
        .table-card {
          background: #fff;
          border: 1px solid #e5e5e5;
          border-radius: 12px;
          padding: 24px;
          overflow-x: auto;
        }

        .data-table {
          width: 100%;
          border-collapse: collapse;
        }

        .data-table th {
          text-align: left;
          padding: 12px;
          font-size: 13px;
          font-weight: 600;
          color: #666;
          border-bottom: 1px solid #e5e5e5;
        }

        .data-table td {
          padding: 16px 12px;
          font-size: 14px;
          border-bottom: 1px solid #f5f5f5;
        }

        .data-table tbody tr:hover {
          background: #fafafa;
        }

        /* Settings */
        .settings-section {
          background: #fff;
          border: 1px solid #e5e5e5;
          border-radius: 12px;
          padding: 24px;
          margin-bottom: 20px;
        }

        .settings-title {
          font-size: 16px;
          font-weight: 600;
          margin-bottom: 20px;
        }

        .setting-item {
          margin-bottom: 20px;
        }

        .setting-item label {
          display: block;
          font-size: 14px;
          font-weight: 500;
          margin-bottom: 8px;
        }

        .setting-input {
          width: 100%;
          max-width: 400px;
          padding: 10px 14px;
          border: 1px solid #e5e5e5;
          border-radius: 8px;
          font-size: 14px;
          transition: all 0.2s;
        }

        .setting-input:focus {
          outline: none;
          border-color: #0a0a0a;
        }

        .setting-item.toggle {
          display: flex;
          align-items: center;
          justify-content: space-between;
        }

        .setting-item.toggle label {
          margin-bottom: 0;
        }

        .save-button {
          padding: 12px 24px;
          background: #0a0a0a;
          color: #fff;
          border: none;
          border-radius: 8px;
          font-size: 14px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s;
        }

        .save-button:hover {
          background: #1a1a1a;
        }

        @media (max-width: 768px) {
          .sidebar {
            width: 70px;
          }
          
          .sidebar .logo,
          .nav-item span {
            display: none;
          }
          
          .main-content {
            margin-left: 70px;
          }
          
          .page-content {
            padding: 20px;
          }
          
          .stats-grid {
            grid-template-columns: 1fr;
          }
          
          .charts-row {
            grid-template-columns: 1fr;
          }
          
          .chart-card.large {
            grid-column: span 1;
          }
        }
      `}</style>
    </div>
  );
};

export default AnalyticsDashboard;
