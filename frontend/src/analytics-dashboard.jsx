import React, { useState, useEffect } from 'react';
import { BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, AreaChart, Area } from 'recharts';
import { Activity, TrendingUp, Users, DollarSign, Database, ArrowUpRight, ArrowDownRight, Menu, X, LayoutDashboard, TrendingDown, Settings, Bell, AlertTriangle, Zap, Server } from 'lucide-react';

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
    { name: 'Direct', value: 4200, color: '#6366f1' },
    { name: 'Organic', value: 3800, color: '#8b5cf6' },
    { name: 'Referral', value: 2100, color: '#ec4899' },
    { name: 'Social', value: 1800, color: '#10b981' },
    { name: 'Email', value: 1200, color: '#38bdf8' },
  ];

  const regionData = [
    { region: 'North America', users: 5200, revenue: 125000 },
    { region: 'Europe', users: 4100, revenue: 98000 },
    { region: 'Asia Pacific', users: 6800, revenue: 142000 },
    { region: 'Latin America', users: 2400, revenue: 52000 },
    { region: 'Middle East', users: 1800, revenue: 41000 },
  ];

  const anomalies = [
    { 
      id: 1, 
      timestamp: '2026-01-27 14:23:15',
      type: 'Traffic Spike',
      severity: 'high',
      metric: 'Requests/sec',
      baseline: '450',
      detected: '1,247',
      change: '+177%',
      status: 'active',
      description: 'Unusual spike in API requests from US-East region'
    },
    { 
      id: 2, 
      timestamp: '2026-01-27 13:45:22',
      type: 'Error Rate',
      severity: 'critical',
      metric: 'Error Rate',
      baseline: '0.5%',
      detected: '4.2%',
      change: '+740%',
      status: 'investigating',
      description: 'Authentication service returning 503 errors'
    },
    { 
      id: 3, 
      timestamp: '2026-01-27 12:18:09',
      type: 'Revenue Drop',
      severity: 'medium',
      metric: 'Conversion Rate',
      baseline: '2.4%',
      detected: '1.1%',
      change: '-54%',
      status: 'resolved',
      description: 'Payment gateway latency affecting checkout completion'
    },
  ];

  return { monthlyData, realTimeData, trafficSources, regionData, anomalies };
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
  const StatCard = ({ icon: Icon, title, value, change, trend, accentColor }) => (
    <div className="stat-card glass">
      <div className="stat-icon-wrapper" style={{ '--accent': accentColor }}>
        <Icon size={24} strokeWidth={2} />
      </div>
      <div className="stat-content">
        <span className="stat-title">{title}</span>
        <div className="stat-value">{value}</div>
        <div className={`stat-change ${trend}`}>
          {trend === 'up' ? <ArrowUpRight size={16} /> : <ArrowDownRight size={16} />}
          <span>{change}</span>
        </div>
      </div>
      <div className="stat-glow" style={{ '--glow-color': accentColor }} />
    </div>
  );

  // Sidebar Component
  const Sidebar = () => (
    <aside className={`sidebar glass-strong ${sidebarOpen ? 'open' : 'closed'}`}>
      <div className="sidebar-header">
        <div className="logo-wrapper">
          <div className="logo-icon">
            <Activity size={24} strokeWidth={2.5} />
          </div>
          {sidebarOpen && <h1 className="logo-text">Nexus</h1>}
        </div>
      </div>
      
      <nav className="sidebar-nav">
        <button 
          className={`nav-item ${activePage === 'overview' ? 'active' : ''}`}
          onClick={() => setActivePage('overview')}
        >
          <LayoutDashboard size={20} strokeWidth={2} />
          {sidebarOpen && <span>Overview</span>}
          {activePage === 'overview' && <div className="nav-indicator" />}
        </button>
        
        <button 
          className={`nav-item ${activePage === 'analytics' ? 'active' : ''}`}
          onClick={() => setActivePage('analytics')}
        >
          <TrendingDown size={20} strokeWidth={2} />
          {sidebarOpen && <span>Analytics</span>}
          {activePage === 'analytics' && <div className="nav-indicator" />}
        </button>
        
        <button 
          className={`nav-item ${activePage === 'anomalies' ? 'active' : ''}`}
          onClick={() => setActivePage('anomalies')}
        >
          <AlertTriangle size={20} strokeWidth={2} />
          {sidebarOpen && <span>Anomalies</span>}
          {data.anomalies.filter(a => a.status === 'active').length > 0 && (
            <span className="badge">{data.anomalies.filter(a => a.status === 'active').length}</span>
          )}
          {activePage === 'anomalies' && <div className="nav-indicator" />}
        </button>
        
        <button 
          className={`nav-item ${activePage === 'realtime' ? 'active' : ''}`}
          onClick={() => setActivePage('realtime')}
        >
          <Activity size={20} strokeWidth={2} />
          {sidebarOpen && <span>Real-time</span>}
          {activePage === 'realtime' && <div className="nav-indicator" />}
        </button>
        
        <button 
          className={`nav-item ${activePage === 'settings' ? 'active' : ''}`}
          onClick={() => setActivePage('settings')}
        >
          <Settings size={20} strokeWidth={2} />
          {sidebarOpen && <span>Settings</span>}
          {activePage === 'settings' && <div className="nav-indicator" />}
        </button>
      </nav>

      <div className="sidebar-footer">
        <div className="system-status">
          <div className="status-dot" />
          {sidebarOpen && <span>All Systems Operational</span>}
        </div>
      </div>
    </aside>
  );

  // Overview Page
  const OverviewPage = () => (
    <div className="page-content">
      <div className="page-header">
        <div>
          <h2 className="page-title">System Overview</h2>
          <p className="page-subtitle">Real-time analytics and performance metrics</p>
        </div>
        <button 
          className={`streaming-badge glass ${isStreaming ? 'active' : ''}`} 
          onClick={() => setIsStreaming(!isStreaming)}
        >
          <div className={`streaming-dot ${isStreaming ? 'active' : ''}`} />
          <span>{isStreaming ? 'Live Stream' : 'Paused'}</span>
        </button>
      </div>

      <div className="stats-grid">
        <StatCard 
          icon={DollarSign} 
          title="Total Revenue" 
          value="$331K" 
          change="+12.5%"
          trend="up"
          accentColor="#6366f1"
        />
        <StatCard 
          icon={Users} 
          title="Active Users" 
          value="17.9K" 
          change="+8.2%"
          trend="up"
          accentColor="#8b5cf6"
        />
        <StatCard 
          icon={Zap} 
          title="Sessions" 
          value="132.5K" 
          change="+15.3%"
          trend="up"
          accentColor="#10b981"
        />
        <StatCard 
          icon={TrendingUp} 
          title="Conversion" 
          value="2.4%" 
          change="-0.3%"
          trend="down"
          accentColor="#ec4899"
        />
      </div>

      <div className="charts-row">
        <div className="chart-card glass large">
          <h3 className="chart-title">Revenue Performance</h3>
          <ResponsiveContainer width="100%" height={300}>
            <AreaChart data={data.monthlyData}>
              <defs>
                <linearGradient id="revenueGlow" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#6366f1" stopOpacity={0.5}/>
                  <stop offset="95%" stopColor="#6366f1" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" vertical={false} />
              <XAxis 
                dataKey="month" 
                stroke="rgba(255,255,255,0.5)" 
                style={{ fontSize: '12px' }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis 
                stroke="rgba(255,255,255,0.5)" 
                style={{ fontSize: '12px' }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip 
                contentStyle={{ 
                  backgroundColor: 'rgba(11, 16, 32, 0.95)', 
                  border: '1px solid rgba(255,255,255,0.14)',
                  borderRadius: 'var(--radius-lg)',
                  backdropFilter: 'blur(14px)',
                  color: 'var(--text)'
                }} 
              />
              <Area 
                type="monotone" 
                dataKey="revenue" 
                stroke="#6366f1" 
                strokeWidth={3}
                fill="url(#revenueGlow)" 
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="chart-card glass">
          <h3 className="chart-title">Traffic Distribution</h3>
          <ResponsiveContainer width="100%" height={300}>
            <PieChart>
              <Pie
                data={data.trafficSources}
                cx="50%"
                cy="50%"
                innerRadius={70}
                outerRadius={100}
                paddingAngle={3}
                dataKey="value"
              >
                {data.trafficSources.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip 
                contentStyle={{ 
                  backgroundColor: 'rgba(11, 16, 32, 0.95)', 
                  border: '1px solid rgba(255,255,255,0.14)',
                  borderRadius: 'var(--radius-lg)',
                  backdropFilter: 'blur(14px)',
                  color: 'var(--text)'
                }} 
              />
            </PieChart>
          </ResponsiveContainer>
          <div className="legend-grid">
            {data.trafficSources.map((source, idx) => (
              <div key={idx} className="legend-item">
                <div className="legend-dot" style={{ backgroundColor: source.color }} />
                <span className="legend-name">{source.name}</span>
                <span className="legend-value">{source.value.toLocaleString()}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="chart-card glass">
        <h3 className="chart-title">Regional Performance</h3>
        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>Region</th>
                <th>Active Users</th>
                <th>Revenue</th>
                <th>Avg. Value</th>
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
    </div>
  );

  // Analytics Page
  const AnalyticsPage = () => (
    <div className="page-content">
      <div className="page-header">
        <div>
          <h2 className="page-title">Deep Analytics</h2>
          <p className="page-subtitle">Comprehensive metrics and trends</p>
        </div>
      </div>

      <div className="charts-row">
        <div className="chart-card glass large">
          <h3 className="chart-title">User Growth Trajectory</h3>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={data.monthlyData}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" vertical={false} />
              <XAxis 
                dataKey="month" 
                stroke="rgba(255,255,255,0.5)" 
                style={{ fontSize: '12px' }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis 
                stroke="rgba(255,255,255,0.5)" 
                style={{ fontSize: '12px' }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip 
                contentStyle={{ 
                  backgroundColor: 'rgba(11, 16, 32, 0.95)', 
                  border: '1px solid rgba(255,255,255,0.14)',
                  borderRadius: 'var(--radius-lg)',
                  backdropFilter: 'blur(14px)',
                  color: 'var(--text)'
                }} 
              />
              <Line 
                type="monotone" 
                dataKey="users" 
                stroke="#8b5cf6" 
                strokeWidth={3}
                dot={{ fill: '#8b5cf6', r: 5, strokeWidth: 2, stroke: 'rgba(11, 16, 32, 0.8)' }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="chart-card glass large">
          <h3 className="chart-title">Sessions & Conversions</h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={data.monthlyData}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" vertical={false} />
              <XAxis 
                dataKey="month" 
                stroke="rgba(255,255,255,0.5)" 
                style={{ fontSize: '12px' }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis 
                stroke="rgba(255,255,255,0.5)" 
                style={{ fontSize: '12px' }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip 
                contentStyle={{ 
                  backgroundColor: 'rgba(11, 16, 32, 0.95)', 
                  border: '1px solid rgba(255,255,255,0.14)',
                  borderRadius: 'var(--radius-lg)',
                  backdropFilter: 'blur(14px)',
                  color: 'var(--text)'
                }} 
              />
              <Bar dataKey="sessions" fill="#10b981" radius={[8, 8, 0, 0]} />
              <Bar dataKey="conversions" fill="#6366f1" radius={[8, 8, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );

  // Anomalies Page
  const AnomaliesPage = () => (
    <div className="page-content">
      <div className="page-header">
        <div>
          <h2 className="page-title">Anomaly Detection</h2>
          <p className="page-subtitle">AI-powered threat monitoring and alerts</p>
        </div>
        <div className="anomaly-summary">
          <div className="anomaly-pill critical">
            <AlertTriangle size={14} />
            <span>1 Critical</span>
          </div>
          <div className="anomaly-pill high">
            <span>1 High</span>
          </div>
          <div className="anomaly-pill resolved">
            <span>1 Resolved</span>
          </div>
        </div>
      </div>

      {data.anomalies.map((anomaly) => (
        <div key={anomaly.id} className={`anomaly-card glass ${anomaly.severity}`}>
          <div className="anomaly-header">
            <div className="anomaly-left">
              <div className={`severity-badge ${anomaly.severity}`}>
                {anomaly.severity}
              </div>
              <h4 className="anomaly-title">{anomaly.type}</h4>
            </div>
            <div className={`status-badge ${anomaly.status}`}>
              {anomaly.status}
            </div>
          </div>
          
          <p className="anomaly-description">{anomaly.description}</p>
          
          <div className="anomaly-metrics">
            <div className="metric-box">
              <span className="metric-label">Baseline</span>
              <span className="metric-value">{anomaly.baseline}</span>
            </div>
            <div className="metric-arrow">→</div>
            <div className="metric-box">
              <span className="metric-label">Detected</span>
              <span className="metric-value highlight">{anomaly.detected}</span>
            </div>
            <div className="metric-box">
              <span className="metric-label">Change</span>
              <span className={`metric-value ${anomaly.severity === 'critical' || anomaly.severity === 'high' ? 'negative' : ''}`}>
                {anomaly.change}
              </span>
            </div>
          </div>
          
          <div className="anomaly-footer">
            <span className="anomaly-timestamp">{anomaly.timestamp}</span>
            <button className="action-btn glass">
              <span>Investigate</span>
              <ArrowUpRight size={16} />
            </button>
          </div>
        </div>
      ))}
    </div>
  );

  // Real-time Page
  const RealTimePage = () => (
    <div className="page-content">
      <div className="page-header">
        <div>
          <h2 className="page-title">Real-time Monitoring</h2>
          <p className="page-subtitle">Live data streaming from AWS infrastructure</p>
        </div>
        <div className="streaming-badge glass active">
          <div className="streaming-dot active" />
          <span>Streaming</span>
        </div>
      </div>

      <div className="stats-grid-mini">
        <div className="mini-stat glass">
          <Server size={20} strokeWidth={2} />
          <div className="mini-content">
            <span className="mini-label">Active Connections</span>
            <span className="mini-value">1,247</span>
          </div>
        </div>
        <div className="mini-stat glass">
          <Zap size={20} strokeWidth={2} />
          <div className="mini-content">
            <span className="mini-label">Requests/Min</span>
            <span className="mini-value">3,842</span>
          </div>
        </div>
        <div className="mini-stat glass">
          <Database size={20} strokeWidth={2} />
          <div className="mini-content">
            <span className="mini-label">Data Throughput</span>
            <span className="mini-value">2.4 GB/s</span>
          </div>
        </div>
      </div>

      <div className="chart-card glass large">
        <h3 className="chart-title">Request Volume Stream</h3>
        <ResponsiveContainer width="100%" height={350}>
          <LineChart data={data.realTimeData}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" vertical={false} />
            <XAxis 
              dataKey="time" 
              stroke="rgba(255,255,255,0.5)" 
              style={{ fontSize: '12px' }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis 
              stroke="rgba(255,255,255,0.5)" 
              style={{ fontSize: '12px' }}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip 
              contentStyle={{ 
                backgroundColor: 'rgba(11, 16, 32, 0.95)', 
                border: '1px solid rgba(255,255,255,0.14)',
                borderRadius: 'var(--radius-lg)',
                backdropFilter: 'blur(14px)',
                color: 'var(--text)'
              }} 
            />
            <Line 
              type="monotone" 
              dataKey="requests" 
              stroke="#10b981" 
              strokeWidth={3}
              dot={false}
              isAnimationActive={false}
            />
            <Line 
              type="monotone" 
              dataKey="errors" 
              stroke="#ef4444" 
              strokeWidth={3}
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
          <h2 className="page-title">System Configuration</h2>
          <p className="page-subtitle">Manage your analytics platform settings</p>
        </div>
      </div>

      <div className="settings-card glass">
        <h3 className="settings-section-title">AWS Integration</h3>
        <div className="setting-row">
          <label>Region</label>
          <select className="setting-select glass">
            <option>us-east-1</option>
            <option>us-west-2</option>
            <option>eu-west-1</option>
          </select>
        </div>
        <div className="setting-row">
          <label>Stream Name</label>
          <input className="setting-input glass" type="text" placeholder="analytics-stream" />
        </div>
        <div className="setting-row">
          <label>Refresh Interval (seconds)</label>
          <input className="setting-input glass" type="number" placeholder="3" />
        </div>
      </div>

      <div className="settings-card glass">
        <h3 className="settings-section-title">Notifications</h3>
        <div className="setting-toggle">
          <span>Enable real-time alerts</span>
          <input type="checkbox" defaultChecked />
        </div>
        <div className="setting-toggle">
          <span>Email daily reports</span>
          <input type="checkbox" />
        </div>
      </div>

      <button className="primary-btn glass">
        <span>Save Configuration</span>
      </button>
    </div>
  );

  return (
    <div className="dashboard-container">
      <Sidebar />
      
      <main className="main-content">
        <header className="top-bar glass">
          <button 
            className="menu-toggle"
            onClick={() => setSidebarOpen(!sidebarOpen)}
          >
            {sidebarOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
          
          <div className="top-bar-right">
            <button className="icon-btn glass">
              <Bell size={20} />
              <span className="notification-dot" />
            </button>
            <div className="user-avatar glass">
              <span>JD</span>
            </div>
          </div>
        </header>

        {activePage === 'overview' && <OverviewPage />}
        {activePage === 'analytics' && <AnalyticsPage />}
        {activePage === 'anomalies' && <AnomaliesPage />}
        {activePage === 'realtime' && <RealTimePage />}
        {activePage === 'settings' && <SettingsPage />}
      </main>

      <style>{`
        .dashboard-container {
          display: flex;
          min-height: 100vh;
          position: relative;
        }

        /* Sidebar */
        .sidebar {
          width: var(--sidebar-w);
          position: fixed;
          height: 100vh;
          left: 0;
          top: 0;
          display: flex;
          flex-direction: column;
          border-right: 1px solid var(--stroke);
          transition: width 0.3s cubic-bezier(0.4, 0, 0.2, 1);
          z-index: 100;
        }

        .sidebar.closed {
          width: var(--sidebar-w-collapsed);
        }

        .sidebar-header {
          padding: 28px 20px;
          border-bottom: 1px solid var(--stroke2);
        }

        .logo-wrapper {
          display: flex;
          align-items: center;
          gap: 14px;
        }

        .logo-icon {
          width: 44px;
          height: 44px;
          border-radius: var(--radius-md);
          background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
          display: flex;
          align-items: center;
          justify-content: center;
          color: #fff;
          flex-shrink: 0;
          box-shadow: 0 0 24px rgba(99, 102, 241, 0.4);
        }

        .logo-text {
          font-size: 22px;
          font-weight: 700;
          letter-spacing: -0.5px;
          background: linear-gradient(135deg, var(--text) 0%, rgba(255,255,255,0.7) 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
        }

        .sidebar-nav {
          flex: 1;
          padding: 16px 12px;
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .nav-item {
          position: relative;
          display: flex;
          align-items: center;
          gap: 14px;
          padding: 14px 16px;
          border: none;
          background: transparent;
          color: var(--muted);
          cursor: pointer;
          border-radius: var(--radius-lg);
          font-size: 15px;
          font-weight: 500;
          transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
        }

        .nav-item:hover {
          background: var(--glass);
          color: var(--text);
        }

        .nav-item.active {
          background: var(--glass2);
          color: var(--text);
          font-weight: 600;
        }

        .nav-indicator {
          position: absolute;
          left: 0;
          top: 50%;
          transform: translateY(-50%);
          width: 3px;
          height: 24px;
          background: linear-gradient(180deg, #6366f1, #8b5cf6);
          border-radius: 0 3px 3px 0;
          box-shadow: 0 0 12px rgba(99, 102, 241, 0.6);
        }

        .badge {
          margin-left: auto;
          padding: 3px 8px;
          background: linear-gradient(135deg, #ef4444, #dc2626);
          color: #fff;
          border-radius: 10px;
          font-size: 11px;
          font-weight: 700;
          box-shadow: 0 0 12px rgba(239, 68, 68, 0.4);
        }

        .sidebar-footer {
          padding: 20px;
          border-top: 1px solid var(--stroke2);
        }

        .system-status {
          display: flex;
          align-items: center;
          gap: 10px;
          font-size: 13px;
          color: var(--muted);
        }

        .status-dot {
          width: 8px;
          height: 8px;
          background: #10b981;
          border-radius: 50%;
          box-shadow: 0 0 12px rgba(16, 185, 129, 0.6);
          animation: pulse-glow 2s infinite;
        }

        @keyframes pulse-glow {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }

        /* Main Content */
        .main-content {
          flex: 1;
          margin-left: var(--sidebar-w);
          transition: margin-left 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        }

        .sidebar.closed ~ .main-content {
          margin-left: var(--sidebar-w-collapsed);
        }

        .top-bar {
          height: 72px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0 32px;
          border-bottom: 1px solid var(--stroke);
          position: sticky;
          top: 0;
          z-index: 50;
        }

        .menu-toggle {
          width: 40px;
          height: 40px;
          border-radius: var(--radius-md);
          border: none;
          background: var(--glass);
          color: var(--text);
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.2s;
        }

        .menu-toggle:hover {
          background: var(--glass2);
        }

        .top-bar-right {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .icon-btn {
          position: relative;
          width: 40px;
          height: 40px;
          border-radius: var(--radius-md);
          border: none;
          color: var(--text);
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.2s;
        }

        .icon-btn:hover {
          background: var(--glass2);
        }

        .notification-dot {
          position: absolute;
          top: 8px;
          right: 8px;
          width: 8px;
          height: 8px;
          background: #ef4444;
          border-radius: 50%;
          border: 2px solid var(--bg0);
          box-shadow: 0 0 8px rgba(239, 68, 68, 0.6);
        }

        .user-avatar {
          width: 40px;
          height: 40px;
          border-radius: var(--radius-md);
          background: linear-gradient(135deg, #6366f1, #8b5cf6);
          color: #fff;
          display: flex;
          align-items: center;
          justify-content: center;
          font-weight: 700;
          font-size: 13px;
          cursor: pointer;
          transition: all 0.2s;
          border: 1px solid rgba(255,255,255,0.2);
        }

        .user-avatar:hover {
          box-shadow: 0 0 20px rgba(99, 102, 241, 0.5);
        }

        /* Page Content */
        .page-content {
          padding: 40px 32px;
          max-width: 1600px;
        }

        .page-header {
          margin-bottom: 32px;
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
        }

        .page-title {
          font-size: 32px;
          font-weight: 700;
          letter-spacing: -1px;
          margin-bottom: 6px;
          color: var(--text);
        }

        .page-subtitle {
          font-size: 15px;
          color: var(--muted);
        }

        .streaming-badge {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 10px 20px;
          border: none;
          border-radius: 24px;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s;
          color: var(--muted);
        }

        .streaming-badge.active {
          color: #10b981;
          box-shadow: 0 0 24px rgba(16, 185, 129, 0.2);
        }

        .streaming-dot {
          width: 8px;
          height: 8px;
          background: var(--muted);
          border-radius: 50%;
        }

        .streaming-dot.active {
          background: #10b981;
          box-shadow: 0 0 12px rgba(16, 185, 129, 0.8);
          animation: pulse-glow 2s infinite;
        }

        /* Stats Grid */
        .stats-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
          gap: 20px;
          margin-bottom: 32px;
        }

        .stat-card {
          position: relative;
          padding: 24px;
          border-radius: var(--radius-xl);
          display: flex;
          gap: 16px;
          overflow: hidden;
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        }

        .stat-card:hover {
          transform: translateY(-2px);
          box-shadow: var(--shadow);
        }

        .stat-icon-wrapper {
          width: 52px;
          height: 52px;
          border-radius: var(--radius-md);
          background: linear-gradient(135deg, var(--accent), color-mix(in srgb, var(--accent) 70%, black));
          display: flex;
          align-items: center;
          justify-content: center;
          color: #fff;
          flex-shrink: 0;
          box-shadow: 0 0 20px color-mix(in srgb, var(--accent) 40%, transparent);
        }

        .stat-content {
          flex: 1;
          display: flex;
          flex-direction: column;
        }

        .stat-title {
          font-size: 13px;
          color: var(--muted);
          font-weight: 500;
          margin-bottom: 8px;
        }

        .stat-value {
          font-size: 28px;
          font-weight: 700;
          letter-spacing: -1px;
          color: var(--text);
          margin-bottom: 8px;
        }

        .stat-change {
          display: flex;
          align-items: center;
          gap: 4px;
          font-size: 13px;
          font-weight: 600;
        }

        .stat-change.up {
          color: #10b981;
        }

        .stat-change.down {
          color: #ef4444;
        }

        .stat-glow {
          position: absolute;
          bottom: 0;
          right: 0;
          width: 120px;
          height: 120px;
          background: radial-gradient(circle at center, var(--glow-color), transparent 70%);
          opacity: 0.15;
          pointer-events: none;
        }

        /* Charts */
        .charts-row {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(500px, 1fr));
          gap: 20px;
          margin-bottom: 24px;
        }

        .chart-card {
          padding: 28px;
          border-radius: var(--radius-xl);
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        }

        .chart-card:hover {
          transform: translateY(-2px);
          box-shadow: var(--shadow);
        }

        .chart-card.large {
          grid-column: span 2;
        }

        @media (max-width: 1400px) {
          .chart-card.large {
            grid-column: span 1;
          }
        }

        .chart-title {
          font-size: 18px;
          font-weight: 600;
          color: var(--text);
          margin-bottom: 24px;
        }

        .legend-grid {
          margin-top: 20px;
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
          gap: 12px;
        }

        .legend-item {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 13px;
        }

        .legend-dot {
          width: 10px;
          height: 10px;
          border-radius: 50%;
          flex-shrink: 0;
        }

        .legend-name {
          flex: 1;
          color: var(--muted);
        }

        .legend-value {
          font-weight: 700;
          color: var(--text);
        }

        /* Table */
        .table-wrapper {
          overflow-x: auto;
        }

        .data-table {
          width: 100%;
          border-collapse: collapse;
        }

        .data-table th {
          text-align: left;
          padding: 14px 16px;
          font-size: 13px;
          font-weight: 600;
          color: var(--muted);
          border-bottom: 1px solid var(--stroke2);
        }

        .data-table td {
          padding: 16px;
          font-size: 14px;
          color: var(--text);
          border-bottom: 1px solid var(--stroke2);
        }

        .data-table tbody tr {
          transition: all 0.2s;
        }

        .data-table tbody tr:hover {
          background: var(--glass);
        }

        /* Anomalies */
        .anomaly-summary {
          display: flex;
          gap: 10px;
        }

        .anomaly-pill {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 8px 16px;
          border-radius: 20px;
          font-size: 12px;
          font-weight: 700;
          border: 1px solid;
        }

        .anomaly-pill.critical {
          background: rgba(239, 68, 68, 0.15);
          border-color: rgba(239, 68, 68, 0.3);
          color: #fca5a5;
        }

        .anomaly-pill.high {
          background: rgba(249, 115, 22, 0.15);
          border-color: rgba(249, 115, 22, 0.3);
          color: #fdba74;
        }

        .anomaly-pill.resolved {
          background: rgba(16, 185, 129, 0.15);
          border-color: rgba(16, 185, 129, 0.3);
          color: #6ee7b7;
        }

        .anomaly-card {
          padding: 28px;
          border-radius: var(--radius-xl);
          margin-bottom: 20px;
          border-left: 3px solid;
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        }

        .anomaly-card.critical {
          border-left-color: #ef4444;
        }

        .anomaly-card.high {
          border-left-color: #f97316;
        }

        .anomaly-card.medium {
          border-left-color: #f59e0b;
        }

        .anomaly-card:hover {
          transform: translateY(-2px);
          box-shadow: var(--shadow);
        }

        .anomaly-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 16px;
        }

        .anomaly-left {
          display: flex;
          align-items: center;
          gap: 14px;
        }

        .severity-badge {
          padding: 6px 14px;
          border-radius: 12px;
          font-size: 11px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }

        .severity-badge.critical {
          background: rgba(239, 68, 68, 0.2);
          border: 1px solid rgba(239, 68, 68, 0.4);
          color: #fca5a5;
        }

        .severity-badge.high {
          background: rgba(249, 115, 22, 0.2);
          border: 1px solid rgba(249, 115, 22, 0.4);
          color: #fdba74;
        }

        .severity-badge.medium {
          background: rgba(245, 158, 11, 0.2);
          border: 1px solid rgba(245, 158, 11, 0.4);
          color: #fde68a;
        }

        .anomaly-title {
          font-size: 18px;
          font-weight: 600;
          color: var(--text);
        }

        .status-badge {
          padding: 6px 16px;
          border-radius: 16px;
          font-size: 12px;
          font-weight: 600;
          border: 1px solid;
        }

        .status-badge.active {
          background: rgba(239, 68, 68, 0.15);
          border-color: rgba(239, 68, 68, 0.3);
          color: #fca5a5;
        }

        .status-badge.investigating {
          background: rgba(245, 158, 11, 0.15);
          border-color: rgba(245, 158, 11, 0.3);
          color: #fde68a;
        }

        .status-badge.resolved {
          background: rgba(16, 185, 129, 0.15);
          border-color: rgba(16, 185, 129, 0.3);
          color: #6ee7b7;
        }

        .anomaly-description {
          color: var(--muted);
          line-height: 1.6;
          margin-bottom: 20px;
        }

        .anomaly-metrics {
          display: flex;
          gap: 16px;
          align-items: center;
          padding: 20px;
          background: var(--glass);
          border-radius: var(--radius-lg);
          margin-bottom: 20px;
        }

        .metric-box {
          flex: 1;
          text-align: center;
        }

        .metric-label {
          display: block;
          font-size: 11px;
          color: var(--muted);
          margin-bottom: 6px;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          font-weight: 600;
        }

        .metric-value {
          font-size: 18px;
          font-weight: 700;
          color: var(--text);
        }

        .metric-value.highlight {
          color: #60a5fa;
        }

        .metric-value.negative {
          color: #ef4444;
        }

        .metric-arrow {
          font-size: 20px;
          color: var(--muted);
        }

        .anomaly-footer {
          display: flex;
          justify-content: space-between;
          align-items: center;
        }

        .anomaly-timestamp {
          font-size: 12px;
          color: var(--muted);
        }

        .action-btn {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 10px 20px;
          border: none;
          border-radius: var(--radius-md);
          font-size: 14px;
          font-weight: 600;
          color: var(--text);
          cursor: pointer;
          transition: all 0.2s;
        }

        .action-btn:hover {
          background: var(--glass2);
          transform: translateX(2px);
        }

        /* Real-time */
        .stats-grid-mini {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
          gap: 20px;
          margin-bottom: 32px;
        }

        .mini-stat {
          display: flex;
          gap: 16px;
          padding: 24px;
          border-radius: var(--radius-xl);
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        }

        .mini-stat:hover {
          transform: translateY(-2px);
          box-shadow: var(--shadow);
        }

        .mini-stat > svg {
          color: #6366f1;
          flex-shrink: 0;
        }

        .mini-content {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .mini-label {
          font-size: 13px;
          color: var(--muted);
          font-weight: 500;
        }

        .mini-value {
          font-size: 24px;
          font-weight: 700;
          color: var(--text);
          letter-spacing: -0.5px;
        }

        /* Settings */
        .settings-card {
          padding: 28px;
          border-radius: var(--radius-xl);
          margin-bottom: 24px;
        }

        .settings-section-title {
          font-size: 18px;
          font-weight: 600;
          color: var(--text);
          margin-bottom: 24px;
        }

        .setting-row {
          margin-bottom: 20px;
        }

        .setting-row label {
          display: block;
          font-size: 14px;
          font-weight: 500;
          color: var(--text);
          margin-bottom: 10px;
        }

        .setting-input,
        .setting-select {
          width: 100%;
          max-width: 500px;
          padding: 12px 16px;
          border: none;
          border-radius: var(--radius-md);
          font-size: 14px;
          color: var(--text);
          transition: all 0.2s;
        }

        .setting-input:focus,
        .setting-select:focus {
          box-shadow: var(--focus);
        }

        .setting-toggle {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 16px 0;
          border-bottom: 1px solid var(--stroke2);
        }

        .setting-toggle:last-child {
          border-bottom: none;
        }

        .setting-toggle span {
          font-size: 14px;
          font-weight: 500;
          color: var(--text);
        }

        .primary-btn {
          padding: 14px 32px;
          border: none;
          border-radius: var(--radius-md);
          font-size: 15px;
          font-weight: 600;
          color: var(--text);
          cursor: pointer;
          transition: all 0.2s;
        }

        .primary-btn:hover {
          background: var(--glass2);
          transform: translateY(-1px);
        }

        /* Responsive */
        @media (max-width: 768px) {
          .sidebar {
            width: var(--sidebar-w-collapsed);
          }
          
          .logo-text,
          .nav-item span,
          .system-status span {
            display: none;
          }
          
          .main-content {
            margin-left: var(--sidebar-w-collapsed);
          }
          
          .page-content {
            padding: 24px 20px;
          }
          
          .stats-grid,
          .stats-grid-mini {
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